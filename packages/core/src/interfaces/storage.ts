/**
 * Storage interface
 */

/** Storage factory type */
export type StorageFactory = (options?: StorageOptions) => IStorage;

/** Storage options */
export interface StorageOptions {
  path?: string;
  namespace?: string;
}

/** Key-value storage interface */
export interface IStorage {
  /** Get a value by key */
  get(key: string): Promise<string | null>;

  /** Set a value by key */
  set(key: string, value: string): Promise<void>;

  /** Delete a value by key */
  delete(key: string): Promise<void>;

  /** Check if a key exists */
  exists(key: string): Promise<boolean>;

  /** Clear all values */
  clear(): Promise<void>;

  /** Get all keys */
  keys?(): Promise<string[]>;

  // Sync API (optional, for platforms that support it)
  getSync?(key: string): string | null;
  setSync?(key: string, value: string): void;
  deleteSync?(key: string): void;
}

// Factory registry
const storageFactories = new Map<string, StorageFactory>();

/** Register a storage factory */
export function registerStorageFactory(type: string, factory: StorageFactory): void {
  storageFactories.set(type, factory);
}

/** Create a storage instance */
export function createStorage(type: string, options?: StorageOptions): IStorage {
  const factory = storageFactories.get(type);
  if (!factory) {
    throw new Error(`Storage factory not found: ${type}. Available: ${[...storageFactories.keys()].join(', ')}`);
  }
  return factory(options);
}

// === Secure Storage ===

/** Secure storage factory type */
export type SecureStorageFactory = (options?: SecureStorageOptions) => ISecureStorage;

/** Secure storage options */
export interface SecureStorageOptions {
  key?: Uint8Array;
  namespace?: string;
}

/** Secure storage interface (encrypted key-value storage) */
export interface ISecureStorage {
  /** Get an item by key */
  getItem(key: string): Promise<string | null>;

  /** Set an item by key */
  setItem(key: string, value: string): Promise<void>;

  /** Delete an item by key */
  deleteItem(key: string): Promise<void>;

  /** Check if an item exists */
  hasItem?(key: string): Promise<boolean>;
}

// Secure storage factory registry
const secureStorageFactories = new Map<string, SecureStorageFactory>();

/** Register a secure storage factory */
export function registerSecureStorageFactory(type: string, factory: SecureStorageFactory): void {
  secureStorageFactories.set(type, factory);
}

/** Create a secure storage instance */
export function createSecureStorage(type: string, options?: SecureStorageOptions): ISecureStorage {
  const factory = secureStorageFactories.get(type);
  if (!factory) {
    throw new Error(`Secure storage factory not found: ${type}. Available: ${[...secureStorageFactories.keys()].join(', ')}`);
  }
  return factory(options);
}
