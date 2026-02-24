/**
 * @agentbridge/interfaces - Database Interface
 * Database abstraction for Edge and VM environments
 */

/**
 * Database query options
 */
export interface QueryOptions {
  /** Limit number of results */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
  /** Order by field */
  orderBy?: string;
  /** Order direction */
  orderDirection?: 'asc' | 'desc';
}

/**
 * Database query result
 */
export interface QueryResult<T> {
  /** Results */
  rows: T[];
  /** Total count (if available) */
  total?: number;
  /** Has more results */
  hasMore?: boolean;
}

/**
 * Database transaction
 */
export interface IDatabaseTransaction {
  /**
   * Commit the transaction
   */
  commit(): Promise<void>;

  /**
   * Rollback the transaction
   */
  rollback(): Promise<void>;
}

/**
 * IDatabase - Database interface
 *
 * Implementations can use:
 * - SQLite (VM)
 * - D1 (Cloudflare)
 * - Turso (Edge)
 * - PlanetScale (Edge)
 * - In-memory (testing)
 */
export interface IDatabase {
  /**
   * Execute a query
   */
  query<T = unknown>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;

  /**
   * Execute a statement (INSERT, UPDATE, DELETE)
   */
  execute(sql: string, params?: unknown[]): Promise<{ changes: number; lastInsertRowId?: number }>;

  /**
   * Execute multiple statements in a transaction
   */
  transaction<T>(fn: (tx: IDatabaseTransaction) => Promise<T>): Promise<T>;

  /**
   * Get a single row
   */
  get<T = unknown>(sql: string, params?: unknown[]): Promise<T | null>;

  /**
   * Get all rows
   */
  all<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;

  /**
   * Close the database connection
   */
  close(): Promise<void>;
}

/**
 * Database configuration
 */
export interface DatabaseConfig {
  /** Database type */
  type: 'sqlite' | 'd1' | 'turso' | 'planetscale' | 'memory';
  /** Database URL (for remote databases) */
  url?: string;
  /** Auth token (for Turso) */
  authToken?: string;
  /** D1 database binding (for Cloudflare) */
  binding?: unknown;
  /** Database file path (for SQLite) */
  filename?: string;
}

/**
 * Database factory function type
 */
export type DatabaseFactory = (config: DatabaseConfig) => IDatabase;

const databaseFactories = new Map<string, DatabaseFactory>();

/**
 * Register a database factory
 */
export function registerDatabaseFactory(type: string, factory: DatabaseFactory): void {
  databaseFactories.set(type, factory);
}

/**
 * Create a database instance
 */
export function createDatabase(config: DatabaseConfig): IDatabase {
  const factory = databaseFactories.get(config.type);
  if (!factory) {
    throw new Error(`Unknown database type: ${config.type}. Available: ${getRegisteredDatabaseTypes().join(', ')}`);
  }
  return factory(config);
}

/**
 * Get list of registered database types
 */
export function getRegisteredDatabaseTypes(): string[] {
  return Array.from(databaseFactories.keys());
}
