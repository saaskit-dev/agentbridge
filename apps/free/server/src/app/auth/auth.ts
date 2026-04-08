import * as privacyKit from 'privacy-kit';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';
const log = new Logger('app/auth/auth');

interface TokenCacheEntry {
  userId: string;
  extras?: any;
  cachedAt: number;
}

interface AuthTokens {
  generator: Awaited<ReturnType<typeof privacyKit.createPersistentTokenGenerator>>;
  verifier: Awaited<ReturnType<typeof privacyKit.createPersistentTokenVerifier>>;
  githubVerifier?: Awaited<ReturnType<typeof privacyKit.createEphemeralTokenVerifier>>;
  githubGenerator?: Awaited<ReturnType<typeof privacyKit.createEphemeralTokenGenerator>>;
}

class AuthModule {
  private tokenCache = new Map<string, TokenCacheEntry>();
  private tokens: AuthTokens | null = null;

  async init(): Promise<void> {
    if (this.tokens) {
      return; // Already initialized
    }

    const secretRaw = process.env.FREE_MASTER_SECRET;
    if (!secretRaw) {
      throw new Error(
        'FREE_MASTER_SECRET is not set. Run via "free-server serve" (auto-generates) or set it manually.'
      );
    }
    // Log a prefix of the seed so we can diagnose cross-restart key mismatches without leaking the full secret
    log.info('Initializing auth module', {
      seedPrefix: secretRaw.slice(0, 8),
      seedLen: secretRaw.length,
    });

    const generator = await privacyKit.createPersistentTokenGenerator({
      service: 'free',
      seed: secretRaw,
    });

    const verifier = await privacyKit.createPersistentTokenVerifier({
      service: 'free',
      publicKey: Uint8Array.from(generator.publicKey),
    });

    // Log public key fingerprint for cross-deploy comparison (this is NOT secret)
    log.info('Auth module key fingerprint', {
      persistentPkHex: Buffer.from(generator.publicKey).toString('hex').slice(0, 16) + '...',
    });

    this.tokens = { generator, verifier };

    log.info('Auth module initialized');
  }

  private async ensureGithubTokens(): Promise<void> {
    if (!this.tokens) {
      throw new Error('Auth module not initialized');
    }
    if (this.tokens.githubGenerator && this.tokens.githubVerifier) {
      return;
    }

    const secretRaw = process.env.FREE_MASTER_SECRET;
    if (!secretRaw) {
      throw new Error('FREE_MASTER_SECRET is not set');
    }

    const githubGenerator = await privacyKit.createEphemeralTokenGenerator({
      service: 'github-free',
      seed: secretRaw,
      ttl: 5 * 60 * 1000, // 5 minutes
    });

    const githubVerifier = await privacyKit.createEphemeralTokenVerifier({
      service: 'github-free',
      publicKey: Uint8Array.from(githubGenerator.publicKey),
    });

    this.tokens.githubGenerator = githubGenerator;
    this.tokens.githubVerifier = githubVerifier;

    log.info('GitHub auth tokens initialized');
  }

  async createToken(userId: string, extras?: any): Promise<string> {
    if (!this.tokens) {
      throw new Error('Auth module not initialized');
    }

    const payload: any = { user: userId };
    if (extras) {
      payload.extras = extras;
    }

    const token = await this.tokens.generator.new(payload);

    // Cache the token immediately
    this.tokenCache.set(token, {
      userId,
      extras,
      cachedAt: Date.now(),
    });

    return token;
  }

  private static readonly CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

  async verifyToken(token: string): Promise<{ userId: string; extras?: any } | null> {
    // Check cache first (with TTL)
    const cached = this.tokenCache.get(token);
    if (cached) {
      if (Date.now() - cached.cachedAt < AuthModule.CACHE_TTL_MS) {
        return {
          userId: cached.userId,
          extras: cached.extras,
        };
      }
      // Cache entry expired, remove it
      this.tokenCache.delete(token);
    }

    // Cache miss - verify token
    if (!this.tokens) {
      throw new Error('Auth module not initialized');
    }

    try {
      const verified = await this.tokens.verifier.verify(token);
      if (!verified) {
        log.warn('Token cryptographic verification returned null', {
          tokenPrefix: token.slice(-12),
        });
        return null;
      }

      const userId = verified.user as string;
      const extras = verified.extras;

      // Cache the result permanently
      this.tokenCache.set(token, {
        userId,
        extras,
        cachedAt: Date.now(),
      });

      return { userId, extras };
    } catch (error) {
      log.error('Token verification threw', {
        error: String(error),
        tokenPrefix: token.slice(-12),
      });
      return null;
    }
  }

  invalidateUserTokens(userId: string): void {
    // Remove all tokens for a specific user
    // This is expensive but rarely needed
    for (const [token, entry] of this.tokenCache.entries()) {
      if (entry.userId === userId) {
        this.tokenCache.delete(token);
      }
    }

    log.info(`Invalidated tokens for user: ${userId}`);
  }

  invalidateToken(token: string): void {
    this.tokenCache.delete(token);
  }

  getCacheStats(): { size: number; oldestEntry: number | null } {
    if (this.tokenCache.size === 0) {
      return { size: 0, oldestEntry: null };
    }

    let oldest = Date.now();
    for (const entry of this.tokenCache.values()) {
      if (entry.cachedAt < oldest) {
        oldest = entry.cachedAt;
      }
    }

    return {
      size: this.tokenCache.size,
      oldestEntry: oldest,
    };
  }

  async createGithubToken(userId: string): Promise<string> {
    if (!this.tokens) {
      throw new Error('Auth module not initialized');
    }
    await this.ensureGithubTokens();

    const payload = { user: userId, purpose: 'github-oauth' };
    const token = await this.tokens.githubGenerator!.new(payload);

    return token;
  }

  async verifyGithubToken(token: string): Promise<{ userId: string } | null> {
    if (!this.tokens) {
      throw new Error('Auth module not initialized');
    }
    await this.ensureGithubTokens();

    try {
      const verified = await this.tokens.githubVerifier!.verify(token);
      if (!verified) {
        return null;
      }

      return { userId: verified.user as string };
    } catch (error) {
      log.error(`GitHub token verification failed: ${error}`);
      return null;
    }
  }

  // Cleanup expired entries — call periodically to bound memory usage
  cleanup(): void {
    const now = Date.now();
    let evicted = 0;
    for (const [token, entry] of this.tokenCache.entries()) {
      if (now - entry.cachedAt > AuthModule.CACHE_TTL_MS) {
        this.tokenCache.delete(token);
        evicted++;
      }
    }
    const stats = this.getCacheStats();
    log.info(`Token cache cleanup: evicted ${evicted}, remaining ${stats.size} entries`);
  }
}

// Global instance
export const auth = new AuthModule();
