/**
 * @agentbridge/interfaces - Auth Interface
 * Authentication and authorization interface
 */

/**
 * Credentials for authentication
 */
export interface Credentials {
  /** API key */
  apiKey?: string;
  /** OAuth token */
  token?: string;
  /** GitHub token */
  githubToken?: string;
}

/**
 * Auth challenge for authentication
 */
export interface AuthChallenge {
  /** Challenge type */
  type: 'api-key' | 'oauth' | 'github';
  /** Challenge data */
  data: Record<string, unknown>;
}

/**
 * Auth response
 */
export interface AuthResponse {
  /** Whether authentication was successful */
  success: boolean;
  /** User ID if successful */
  userId?: string;
  /** Error message if failed */
  error?: string;
  /** Token to use for subsequent requests */
  token?: string;
}

/**
 * User info
 */
export interface UserInfo {
  /** User ID */
  id: string;
  /** Email */
  email?: string;
  /** Display name */
  name?: string;
  /** Avatar URL */
  avatarUrl?: string;
  /** GitHub info */
  github?: {
    id: number;
    login: string;
    avatar_url: string;
  };
}

/**
 * IAuthVerifier - Verify authentication tokens
 *
 * Implementations can use:
 * - JWT verification
 * - API key verification
 * - OAuth verification
 * - Mock for testing
 */
export interface IAuthVerifier {
  /**
   * Verify a token and extract user ID
   */
  verifyToken(token: string): Promise<{ userId: string } | null>;

  /**
   * Get user info from token
   */
  getUserInfo(token: string): Promise<UserInfo | null>;
}

/**
 * IAuth - Authentication interface
 *
 * Complete authentication flow including login, logout, and token management.
 */
export interface IAuth {
  /**
   * Get current credentials
   */
  getCredentials(): Credentials | null;

  /**
   * Set credentials
   */
  setCredentials(credentials: Credentials): void;

  /**
   * Clear credentials
   */
  clearCredentials(): void;

  /**
   * Check if authenticated
   */
  isAuthenticated(): boolean;

  /**
   * Get current user info
   */
  getCurrentUser(): Promise<UserInfo | null>;

  /**
   * Login with credentials
   */
  login(credentials: Credentials): Promise<AuthResponse>;

  /**
   * Logout
   */
  logout(): Promise<void>;

  /**
   * Refresh token if needed
   */
  refreshToken(): Promise<string | null>;
}

/**
 * Auth factory function type
 */
export type AuthFactory = () => IAuth;

const authFactories = new Map<string, AuthFactory>();

/**
 * Register an auth factory
 */
export function registerAuthFactory(type: string, factory: AuthFactory): void {
  authFactories.set(type, factory);
}

/**
 * Create an auth instance
 */
export function createAuth(type = 'default'): IAuth {
  const factory = authFactories.get(type);
  if (!factory) {
    throw new Error(`Unknown auth type: ${type}. Available: ${getRegisteredAuthTypes().join(', ')}`);
  }
  return factory();
}

/**
 * Get list of registered auth types
 */
export function getRegisteredAuthTypes(): string[] {
  return Array.from(authFactories.keys());
}
