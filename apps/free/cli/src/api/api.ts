import axios from 'axios';
import chalk from 'chalk';
import { createHash } from 'node:crypto';
import tweetnacl from 'tweetnacl';
import { ApiMachineClient } from './apiMachine';
import { ApiSessionClient } from './apiSession';
import {
  decodeBase64,
  encodeBase64,
  getRandomBytes,
  encryptToWireString,
  decryptFromWireString,
  libsodiumEncryptForPublicKey,
  libsodiumPublicKeyFromSecretKey,
} from './encryption';
import { PushNotificationClient } from './pushNotifications';
import type {
  AgentState,
  CreateSessionResponse,
  Metadata,
  Session,
  Machine,
  MachineMetadata,
  DaemonState,
} from '@/api/types';
import { configuration } from '@/configuration';
import { Credentials } from '@/persistence';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';
import { safeStringify } from '@saaskit-dev/agentbridge';
import { connectionState, isNetworkError } from '@/utils/serverConnectionErrors';

const logger = new Logger('api/api');

/**
 * Try to recover a session encryption key from the v1 block of dataEncryptionKey.
 * The v1 block is encrypted for libsodiumPublicKeyFromSecretKey(machineKey).
 * Returns the session key if found and decrypted, null otherwise.
 */
function tryRecoverSessionKey(dataEncKeyB64: string, machineKey: Uint8Array): Uint8Array | null {
  try {
    const bundle = decodeBase64(dataEncKeyB64);
    // v1 block starts at byte 105: [0x00(1)][block0(104)] = 105 bytes, then [0x01(1)][block1(104)]
    const V1_OFFSET = 105;
    if (bundle.length < V1_OFFSET + 1 || bundle[V1_OFFSET] !== 0x01) {
      return null;
    }
    const block = bundle.slice(V1_OFFSET + 1);
    const ephPubKey = block.slice(0, 32);
    const nonce = block.slice(32, 56);
    const ciphertext = block.slice(56);
    const hashedSeed = new Uint8Array(createHash('sha512').update(machineKey).digest());
    const boxSecretKey = hashedSeed.slice(0, 32);
    return tweetnacl.box.open(ciphertext, nonce, ephPubKey, boxSecretKey) || null;
  } catch {
    return null;
  }
}

export class ApiClient {
  static async create(credential: Credentials) {
    return new ApiClient(credential);
  }

  private readonly credential: Credentials;
  private readonly pushClient: PushNotificationClient;

  private constructor(credential: Credentials) {
    this.credential = credential;
    this.pushClient = new PushNotificationClient(credential.token, configuration.serverUrl);
  }

  private async createSessionEncryptionContext() {
    let dataEncryptionKey: Uint8Array | null = null;
    let encryptionKey: Uint8Array;
    let encryptionVariant: 'legacy' | 'dataKey';
    if (this.credential.encryption.type === 'dataKey') {
      encryptionKey = getRandomBytes(32);
      encryptionVariant = 'dataKey';

      const encryptedForPublicKey = libsodiumEncryptForPublicKey(
        encryptionKey,
        this.credential.encryption.publicKey
      );
      const machineBoxPubKey = libsodiumPublicKeyFromSecretKey(
        this.credential.encryption.machineKey
      );
      const encryptedForMachineKey = libsodiumEncryptForPublicKey(encryptionKey, machineBoxPubKey);

      dataEncryptionKey = new Uint8Array(
        1 + encryptedForPublicKey.length + 1 + encryptedForMachineKey.length
      );
      dataEncryptionKey.set([0], 0);
      dataEncryptionKey.set(encryptedForPublicKey, 1);
      dataEncryptionKey.set([1], 1 + encryptedForPublicKey.length);
      dataEncryptionKey.set(encryptedForMachineKey, 1 + encryptedForPublicKey.length + 1);
    } else {
      encryptionKey = this.credential.encryption.secret;
      encryptionVariant = 'legacy';
    }

    return {
      dataEncryptionKey,
      encryptionKey,
      encryptionVariant,
    };
  }

  private async decodeSessionResponse(
    raw: CreateSessionResponse['session'],
    encryptionKey: Uint8Array,
    encryptionVariant: 'legacy' | 'dataKey'
  ): Promise<Session> {
    const session: Session = {
      id: raw.id,
      seq: raw.seq,
      metadata: await decryptFromWireString(encryptionKey, encryptionVariant, raw.metadata),
      metadataVersion: raw.metadataVersion,
      agentState: raw.agentState
        ? await decryptFromWireString(encryptionKey, encryptionVariant, raw.agentState)
        : null,
      agentStateVersion: raw.agentStateVersion,
      capabilities: raw.capabilities
        ? await decryptFromWireString(encryptionKey, encryptionVariant, raw.capabilities)
        : null,
      capabilitiesVersion: raw.capabilitiesVersion ?? 0,
      encryptionKey,
      encryptionVariant,
    };
    if (this.credential.encryption.type === 'dataKey' && raw.dataEncryptionKey) {
      const recovered = tryRecoverSessionKey(
        raw.dataEncryptionKey,
        this.credential.encryption.machineKey
      );
      if (recovered) {
        session.encryptionKey = recovered;
        session.metadata = await decryptFromWireString(recovered, encryptionVariant, raw.metadata);
        if (raw.agentState) {
          session.agentState = await decryptFromWireString(
            recovered,
            encryptionVariant,
            raw.agentState
          );
        }
      }
    }
    return session;
  }

  /**
   * Get or create a session by client-generated ID.
   * If the server returns 409 (ID taken by a deleted session or another user),
   * generates a new UUID and retries (up to 3 attempts).
   */
  async getOrCreateSession(opts: {
    id: string;
    metadata: Metadata;
    state: AgentState | null;
    machineId?: string;
  }): Promise<Session | null> {
    const { dataEncryptionKey, encryptionKey, encryptionVariant } =
      await this.createSessionEncryptionContext();

    // Get or create session — retry with new UUID on 409 conflict
    let sessionId = opts.id;
    for (let attempt = 0; attempt < 3; attempt++) {
      const encryptedMetadata = await encryptToWireString(
        encryptionKey,
        encryptionVariant,
        opts.metadata
      );
      const encryptedState = opts.state
        ? await encryptToWireString(encryptionKey, encryptionVariant, opts.state)
        : null;
      try {
        const response = await axios.post<CreateSessionResponse>(
          `${configuration.serverUrl}/v1/sessions`,
          {
            id: sessionId,
            metadata: encryptedMetadata,
            agentState: encryptedState,
            dataEncryptionKey: dataEncryptionKey ? encodeBase64(dataEncryptionKey) : null,
            ...(opts.machineId ? { machineId: opts.machineId } : {}),
          },
          {
            headers: {
              Authorization: `Bearer ${this.credential.token}`,
              'Content-Type': 'application/json',
            },
            timeout: 60000,
            validateStatus: status => status === 200 || status === 409,
          }
        );

        if (response.status === 409) {
          const { randomUUID } = await import('node:crypto');
          sessionId = randomUUID().replace(/-/g, '');
          logger.debug(`Session ID conflict, retrying with new ID (attempt ${attempt + 1})`);
          continue;
        }

        logger.debug(`Session created/loaded: ${response.data.session.id}`);
        const raw = response.data.session;
        return this.decodeSessionResponse(raw, encryptionKey, encryptionVariant);
      } catch (error) {
        logger.debug('[API] [ERROR] Failed to get or create session:', error);

        // Check if it's a connection error
        if (error && typeof error === 'object' && 'code' in error) {
          const errorCode = (error as any).code;
          if (isNetworkError(errorCode)) {
            connectionState.fail({
              operation: 'Session creation',
              caller: 'api.getOrCreateSession',
              errorCode,
              url: `${configuration.serverUrl}/v1/sessions`,
            });
            return null;
          }
        }

        // Handle 404 gracefully - server endpoint may not be available yet
        const is404Error =
          (axios.isAxiosError(error) && error.response?.status === 404) ||
          (error &&
            typeof error === 'object' &&
            'response' in error &&
            (error as any).response?.status === 404);
        if (is404Error) {
          connectionState.fail({
            operation: 'Session creation',
            errorCode: '404',
            url: `${configuration.serverUrl}/v1/sessions`,
          });
          return null;
        }

        // Handle 5xx server errors - use offline mode with auto-reconnect
        if (axios.isAxiosError(error) && error.response?.status) {
          const status = error.response.status;
          if (status >= 500) {
            connectionState.fail({
              operation: 'Session creation',
              errorCode: String(status),
              url: `${configuration.serverUrl}/v1/sessions`,
              details: ['Server encountered an error, will retry automatically'],
            });
            return null;
          }
        }

        throw new Error(`Failed to get or create session: ${safeStringify(error)}`);
      }
    } // end for loop
    throw new Error('Failed to create session: ID conflict after 3 attempts');
  }

  async restoreSession(opts: {
    id: string;
    metadata: Metadata;
    machineId?: string;
  }): Promise<Session | null> {
    const { encryptionKey, encryptionVariant } = await this.createSessionEncryptionContext();
    const encryptedMetadata = await encryptToWireString(
      encryptionKey,
      encryptionVariant,
      opts.metadata
    );

    try {
      const response = await axios.post<CreateSessionResponse>(
        `${configuration.serverUrl}/v1/sessions/${opts.id}/restore`,
        {
          metadata: encryptedMetadata,
          ...(opts.machineId ? { machineId: opts.machineId } : {}),
        },
        {
          headers: {
            Authorization: `Bearer ${this.credential.token}`,
            'Content-Type': 'application/json',
          },
          timeout: 60000,
        }
      );

      logger.debug(`Session restored: ${response.data.session.id}`);
      return this.decodeSessionResponse(response.data.session, encryptionKey, encryptionVariant);
    } catch (error) {
      logger.debug('[API] [ERROR] Failed to restore session:', error);

      if (error && typeof error === 'object' && 'code' in error) {
        const errorCode = (error as any).code;
        if (isNetworkError(errorCode)) {
          connectionState.fail({
            operation: 'Session restore',
            caller: 'api.restoreSession',
            errorCode,
            url: `${configuration.serverUrl}/v1/sessions/${opts.id}/restore`,
          });
          return null;
        }
      }

      const is404Error =
        (axios.isAxiosError(error) && error.response?.status === 404) ||
        (error &&
          typeof error === 'object' &&
          'response' in error &&
          (error as any).response?.status === 404);
      if (is404Error) {
        connectionState.fail({
          operation: 'Session restore',
          errorCode: '404',
          url: `${configuration.serverUrl}/v1/sessions/${opts.id}/restore`,
        });
        return null;
      }

      if (axios.isAxiosError(error) && error.response?.status) {
        const status = error.response.status;
        if (status >= 500) {
          connectionState.fail({
            operation: 'Session restore',
            errorCode: String(status),
            url: `${configuration.serverUrl}/v1/sessions/${opts.id}/restore`,
            details: ['Server encountered an error, will retry automatically'],
          });
          return null;
        }
      }

      throw new Error(`Failed to restore session: ${safeStringify(error)}`);
    }
  }

  /**
   * Register or update machine with the server
   * Returns the current machine state from the server with decrypted metadata and daemonState
   */
  async getOrCreateMachine(opts: {
    machineId: string;
    metadata: MachineMetadata;
    daemonState?: DaemonState;
  }): Promise<Machine> {
    // Resolve encryption key
    let dataEncryptionKey: Uint8Array | null = null;
    let encryptionKey: Uint8Array;
    let encryptionVariant: 'legacy' | 'dataKey';
    if (this.credential.encryption.type === 'dataKey') {
      // Encrypt data encryption key
      encryptionVariant = 'dataKey';
      encryptionKey = this.credential.encryption.machineKey;
      const encryptedDataKey = libsodiumEncryptForPublicKey(
        this.credential.encryption.machineKey,
        this.credential.encryption.publicKey
      );
      dataEncryptionKey = new Uint8Array(encryptedDataKey.length + 1);
      dataEncryptionKey.set([0], 0); // Version byte
      dataEncryptionKey.set(encryptedDataKey, 1); // Data key
    } else {
      // Legacy encryption
      encryptionKey = this.credential.encryption.secret;
      encryptionVariant = 'legacy';
    }

    // Helper to create minimal machine object for offline mode (DRY)
    const createMinimalMachine = (): Machine => {
      logger.warn('[api] entering offline mode (createMinimalMachine fallback)', {
        machineId: opts.machineId,
      });
      return {
        id: opts.machineId,
        encryptionKey: encryptionKey,
        encryptionVariant: encryptionVariant,
        metadata: opts.metadata,
        metadataVersion: 0,
        daemonState: opts.daemonState || null,
        daemonStateVersion: 0,
      };
    };

    // Create machine
    try {
      const response = await axios.post(
        `${configuration.serverUrl}/v1/machines`,
        {
          id: opts.machineId,
          metadata: await encryptToWireString(encryptionKey, encryptionVariant, opts.metadata),
          daemonState: opts.daemonState
            ? await encryptToWireString(encryptionKey, encryptionVariant, opts.daemonState)
            : undefined,
          dataEncryptionKey: dataEncryptionKey ? encodeBase64(dataEncryptionKey) : undefined,
        },
        {
          headers: {
            Authorization: `Bearer ${this.credential.token}`,
            'Content-Type': 'application/json',
          },
          timeout: 60000, // 1 minute timeout for very bad network connections
        }
      );

      const raw = response.data.machine;
      logger.debug(`[API] Machine ${opts.machineId} registered/updated with server`);

      // Return decrypted machine like we do for sessions
      const machine: Machine = {
        id: raw.id,
        encryptionKey: encryptionKey,
        encryptionVariant: encryptionVariant,
        metadata: raw.metadata
          ? await decryptFromWireString(encryptionKey, encryptionVariant, raw.metadata)
          : null,
        metadataVersion: raw.metadataVersion || 0,
        daemonState: raw.daemonState
          ? await decryptFromWireString(encryptionKey, encryptionVariant, raw.daemonState)
          : null,
        daemonStateVersion: raw.daemonStateVersion || 0,
      };
      return machine;
    } catch (error) {
      // Handle connection errors gracefully
      if (axios.isAxiosError(error) && error.code && isNetworkError(error.code)) {
        connectionState.fail({
          operation: 'Machine registration',
          caller: 'api.getOrCreateMachine',
          errorCode: error.code,
          url: `${configuration.serverUrl}/v1/machines`,
        });
        return createMinimalMachine();
      }

      // Handle 403/409 - server rejected request due to authorization conflict
      // This is NOT "server unreachable" - server responded, so don't use connectionState
      if (axios.isAxiosError(error) && error.response?.status) {
        const status = error.response.status;

        // Handle 401 - authentication token expired or invalid
        if (status === 401) {
          console.log(chalk.red('❌ Authentication failed (401 Unauthorized)'));
          console.log(chalk.yellow('   → Your login session has expired or is invalid'));
          console.log(chalk.yellow('   → Please re-authenticate by running:'));
          console.log(chalk.cyan('     free login'));
          console.log(chalk.yellow('   → Or if you want to reset everything:'));
          console.log(chalk.cyan('     free doctor clean && free login'));
          return createMinimalMachine();
        }

        if (status === 403 || status === 409) {
          // Re-auth conflict: machine registered to old account, re-association not allowed
          console.log(
            chalk.yellow(`⚠️  Machine registration rejected by the server with status ${status}`)
          );
          console.log(
            chalk.yellow(
              `   → This machine ID is already registered to another account on the server`
            )
          );
          console.log(
            chalk.yellow(
              `   → This usually happens after re-authenticating with a different account`
            )
          );
          console.log(
            chalk.yellow(
              `   → Run 'free doctor clean' to reset local state and generate a new machine ID`
            )
          );
          console.log(chalk.yellow(`   → Open a GitHub issue if this problem persists`));
          return createMinimalMachine();
        }

        // Handle 5xx - server error, use offline mode with auto-reconnect
        if (status >= 500) {
          connectionState.fail({
            operation: 'Machine registration',
            errorCode: String(status),
            url: `${configuration.serverUrl}/v1/machines`,
            details: ['Server encountered an error, will retry automatically'],
          });
          return createMinimalMachine();
        }

        // Handle 404 - endpoint may not be available yet
        if (status === 404) {
          connectionState.fail({
            operation: 'Machine registration',
            errorCode: '404',
            url: `${configuration.serverUrl}/v1/machines`,
          });
          return createMinimalMachine();
        }
      }

      // For other errors, rethrow
      throw error;
    }
  }

  sessionSyncClient(session: Session): ApiSessionClient {
    return new ApiSessionClient(this.credential.token, session);
  }

  machineSyncClient(machine: Machine): ApiMachineClient {
    return new ApiMachineClient(this.credential.token, machine);
  }

  push(): PushNotificationClient {
    return this.pushClient;
  }

  /**
   * Register a vendor API token with the server
   * The token is sent as a JSON string - server handles encryption
   */
  async registerVendorToken(vendor: 'openai' | 'anthropic' | 'gemini', apiKey: any): Promise<void> {
    try {
      const response = await axios.post(
        `${configuration.serverUrl}/v1/connect/${vendor}/register`,
        {
          token: JSON.stringify(apiKey),
        },
        {
          headers: {
            Authorization: `Bearer ${this.credential.token}`,
            'Content-Type': 'application/json',
          },
          timeout: 5000,
        }
      );

      if (response.status !== 200 && response.status !== 201) {
        throw new Error(`Server returned status ${response.status}`);
      }

      logger.debug(`[API] Vendor token for ${vendor} registered successfully`);
    } catch (error) {
      logger.debug(`[API] [ERROR] Failed to register vendor token:`, error);
      throw new Error(`Failed to register vendor token: ${safeStringify(error)}`);
    }
  }

  /**
   * Get vendor API token from the server
   * Returns the token if it exists, null otherwise
   */
  async getVendorToken(vendor: 'openai' | 'anthropic' | 'gemini'): Promise<any | null> {
    try {
      const response = await axios.get(`${configuration.serverUrl}/v1/connect/${vendor}/token`, {
        headers: {
          Authorization: `Bearer ${this.credential.token}`,
          'Content-Type': 'application/json',
        },
        timeout: 5000,
      });

      if (response.status === 404) {
        logger.debug(`[API] No vendor token found for ${vendor}`);
        return null;
      }

      if (response.status !== 200) {
        throw new Error(`Server returned status ${response.status}`);
      }

      // Log raw response for debugging
      logger.debug(`[API] Raw vendor token response:`, {
        status: response.status,
        dataKeys: Object.keys(response.data || {}),
        hasToken: 'token' in (response.data || {}),
        tokenType: typeof response.data?.token,
      });

      // Token is returned as JSON string, parse it
      let tokenData: any = null;
      if (response.data?.token) {
        if (typeof response.data.token === 'string') {
          try {
            tokenData = JSON.parse(response.data.token);
          } catch (parseError) {
            logger.debug(`[API] Failed to parse token as JSON, using as string:`, parseError);
            tokenData = response.data.token;
          }
        } else if (response.data.token !== null) {
          // Token exists and is not null
          tokenData = response.data.token;
        } else {
          // Token is explicitly null - treat as not found
          logger.debug(`[API] Token is null for ${vendor}, treating as not found`);
          return null;
        }
      } else if (response.data && typeof response.data === 'object') {
        // Maybe the token is directly in response.data
        // But check if it's { token: null } - treat as not found
        if (response.data.token === null && Object.keys(response.data).length === 1) {
          logger.debug(
            `[API] Response contains only null token for ${vendor}, treating as not found`
          );
          return null;
        }
        tokenData = response.data;
      }

      // Final check: if tokenData is null or { token: null }, return null
      if (
        tokenData === null ||
        (tokenData &&
          typeof tokenData === 'object' &&
          tokenData.token === null &&
          Object.keys(tokenData).length === 1)
      ) {
        logger.debug(`[API] Token data is null for ${vendor}`);
        return null;
      }

      logger.debug(`[API] Vendor token for ${vendor} retrieved successfully`, {
        tokenDataType: typeof tokenData,
        tokenDataKeys:
          tokenData && typeof tokenData === 'object' ? Object.keys(tokenData) : 'not an object',
      });
      return tokenData;
    } catch (error: any) {
      if (error.response?.status === 404) {
        logger.debug(`[API] No vendor token found for ${vendor}`);
        return null;
      }
      logger.debug(`[API] [ERROR] Failed to get vendor token:`, error);
      return null;
    }
  }

  /**
   * Fetch sessions by ID from the server and decrypt their metadata.
   * Used to repair corrupted local persistence files — the server is the source of truth.
   * Makes a single GET /v1/sessions call and filters client-side by the requested IDs.
   * Returns a map of sessionId → decrypted data for sessions that could be recovered.
   */
  async fetchOfflineSessions(
    sessionIds: string[]
  ): Promise<Map<string, { metadata: Metadata; seq: number; createdAt: number }>> {
    const result = new Map<string, { metadata: Metadata; seq: number; createdAt: number }>();
    if (sessionIds.length === 0) return result;

    try {
      const response = await axios.get<{
        sessions: Array<{
          id: string;
          seq: number;
          status: string;
          metadata: string | null;
          dataEncryptionKey: string | null;
          createdAt: number;
        }>;
      }>(`${configuration.serverUrl}/v1/sessions`, {
        headers: { Authorization: `Bearer ${this.credential.token}` },
        timeout: 15000,
      });

      const targetIds = new Set(sessionIds);
      for (const raw of response.data.sessions) {
        if (!targetIds.has(raw.id) || raw.status !== 'offline' || !raw.metadata) continue;
        try {
          let encryptionKey: Uint8Array;
          const encryptionVariant: 'legacy' | 'dataKey' =
            this.credential.encryption.type === 'dataKey' ? 'dataKey' : 'legacy';
          if (this.credential.encryption.type === 'dataKey') {
            if (!raw.dataEncryptionKey) continue;
            const recovered = tryRecoverSessionKey(
              raw.dataEncryptionKey,
              this.credential.encryption.machineKey
            );
            if (!recovered) continue;
            encryptionKey = recovered;
          } else {
            encryptionKey = this.credential.encryption.secret;
          }
          const metadata = await decryptFromWireString(encryptionKey, encryptionVariant, raw.metadata);
          result.set(raw.id, { metadata, seq: raw.seq, createdAt: raw.createdAt });
        } catch {
          // Skip sessions we can't decrypt
        }
      }
    } catch (err) {
      logger.warn('[API] fetchOfflineSessions failed', { error: String(err) });
    }

    return result;
  }

  /**
   * Get account settings from server (for syncing analyticsEnabled etc.)
   * Returns the settings object if successful, null otherwise
   */
  async getAccountSettings(): Promise<{ settings: string | null; settingsVersion: number } | null> {
    try {
      const response = await axios.get(`${configuration.serverUrl}/v1/account/settings`, {
        headers: {
          Authorization: `Bearer ${this.credential.token}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      });

      if (response.status !== 200) {
        logger.debug(`[API] Account settings returned status ${response.status}`);
        return null;
      }

      return {
        settings: response.data.settings,
        settingsVersion: response.data.settingsVersion,
      };
    } catch (error: any) {
      if (error.response?.status === 401) {
        logger.debug('[API] Unauthorized when fetching account settings');
        return null;
      }
      if (error.response?.status === 404) {
        logger.debug('[API] Account settings not found');
        return null;
      }
      logger.debug('[API] Failed to get account settings', {
        code: error?.code ?? null,
        status: error?.response?.status ?? null,
      });
      return null;
    }
  }
}
