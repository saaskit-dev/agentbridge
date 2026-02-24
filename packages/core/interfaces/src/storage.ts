/**
 * @agentbridge/interfaces - Storage Interface
 * Platform-agnostic storage interface
 */

/**
 * IStorage - Basic key-value storage interface
 *
 * Implementations can use:
 * - localStorage (browser)
 * - In-memory (testing)
 * - Platform-specific storage
 */
export interface IStorage {
  /**
   * Get value by key
   */
  get<T>(key: string): Promise<T | null>;

  /**
   * Set value by key
   */
  set<T>(key: string, value: T): Promise<void>;

  /**
   * Delete value by key
   */
  delete(key: string): Promise<void>;

  /**
   * Check if key exists
   */
  has(key: string): Promise<boolean>;

  /**
   * Get all keys
   */
  keys(): Promise<string[]>;

  /**
   * Clear all data
   */
  clear(): Promise<void>;
}

/**
 * ISecureStorage - Encrypted storage interface
 *
 * Uses encryption to protect data at rest.
 */
export interface ISecureStorage extends IStorage {
  /**
   * Initialize with encryption key
   */
  initialize(key: Uint8Array): Promise<void>;

  /**
   * Change encryption key
   */
  rotateKey(newKey: Uint8Array): Promise<void>;
}

/**
 * IBlobStorage - Binary large object storage
 *
 * For storing large binary data like files, images, etc.
 */
export interface IBlobStorage {
  /**
   * Upload blob
   */
  upload(key: string, data: Uint8Array, metadata?: Record<string, string>): Promise<string>;

  /**
   * Download blob
   */
  download(key: string): Promise<Uint8Array | null>;

  /**
   * Delete blob
   */
  delete(key: string): Promise<void>;

  /**
   * Check if blob exists
   */
  has(key: string): Promise<boolean>;

  /**
   * Get blob URL (if supported)
   */
  getUrl?(key: string): Promise<string | null>;
}

/**
 * Storage options
 */
export interface StorageOptions {
  /** Namespace prefix for keys */
  namespace?: string;
  /** Maximum key length */
  maxKeyLength?: number;
  /** Maximum value size in bytes */
  maxValueSize?: number;
}

/**
 * Storage factory function type
 */
export type StorageFactory = (options?: StorageOptions) => IStorage;

const storageFactories = new Map<string, StorageFactory>();

/**
 * Register a storage factory
 */
export function registerStorageFactory(type: string, factory: StorageFactory): void {
  storageFactories.set(type, factory);
}

/**
 * Create a storage instance
 */
export function createStorage(type = 'memory', options?: StorageOptions): IStorage {
  const factory = storageFactories.get(type);
  if (!factory) {
    throw new Error(`Unknown storage type: ${type}. Available: ${getRegisteredStorageTypes().join(', ')}`);
  }
  return factory(options);
}

/**
 * Get list of registered storage types
 */
export function getRegisteredStorageTypes(): string[] {
  return Array.from(storageFactories.keys());
}

/**
 * In-memory storage implementation (for testing)
 */
export class InMemoryStorage implements IStorage {
  private data = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | null> {
    const value = this.data.get(key);
    return value !== undefined ? (value as T) : null;
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.data.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }

  async has(key: string): Promise<boolean> {
    return this.data.has(key);
  }

  async keys(): Promise<string[]> {
    return Array.from(this.data.keys());
  }

  async clear(): Promise<void> {
    this.data.clear();
  }
}

// Register default in-memory storage
registerStorageFactory('memory', () => new InMemoryStorage());
