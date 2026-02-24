/**
 * @agentbridge/storage-fs - File System Storage
 *
 * File system based storage for Node.js environments
 */

import type { IStorage } from '@agentbridge/interfaces';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * File system storage options
 */
export interface FileSystemStorageOptions {
  /** Base directory for storage */
  dir: string;
  /** Namespace prefix for all keys */
  namespace?: string;
}

/**
 * File system storage implementation
 *
 * Each key is stored as a separate JSON file in the base directory.
 * Keys are encoded to be filesystem-safe.
 */
export class FileSystemStorage implements IStorage {
  private dir: string;
  private namespace: string;
  private initialized = false;

  constructor(options: FileSystemStorageOptions) {
    this.dir = options.dir;
    this.namespace = options.namespace || '';
  }

  /**
   * Initialize storage - create directory if needed
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    const basePath = this.namespace ? path.join(this.dir, this.namespace) : this.dir;

    try {
      await fs.mkdir(basePath, { recursive: true });
    } catch {
      // Directory already exists
    }
    this.initialized = true;
  }

  private getFilePath(key: string): string {
    const safeKey = this.encodeKey(key);
    const basePath = this.namespace ? path.join(this.dir, this.namespace) : this.dir;
    return path.join(basePath, safeKey);
  }

  private encodeKey(key: string): string {
    // Use base64url encoding for safe filenames
    return Buffer.from(key).toString('base64url');
  }

  private decodeKey(encoded: string): string {
    return Buffer.from(encoded, 'base64url').toString('utf-8');
  }

  async get<T>(key: string): Promise<T | null> {
    await this.init();
    const filePath = this.getFilePath(key);

    try {
      const data = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(data) as T;
    } catch {
      return null;
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    await this.init();
    const filePath = this.getFilePath(key);
    await fs.writeFile(filePath, JSON.stringify(value));
  }

  async delete(key: string): Promise<void> {
    await this.init();
    const filePath = this.getFilePath(key);

    try {
      await fs.unlink(filePath);
    } catch {
      // File doesn't exist, ignore
    }
  }

  async has(key: string): Promise<boolean> {
    await this.init();
    const filePath = this.getFilePath(key);

    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async keys(): Promise<string[]> {
    await this.init();
    const basePath = this.namespace ? path.join(this.dir, this.namespace) : this.dir;

    try {
      const files = await fs.readdir(basePath);
      return files.map(f => this.decodeKey(f));
    } catch {
      return [];
    }
  }

  async clear(): Promise<void> {
    await this.init();
    const basePath = this.namespace ? path.join(this.dir, this.namespace) : this.dir;

    try {
      const files = await fs.readdir(basePath);
      await Promise.all(files.map(f => fs.unlink(path.join(basePath, f))));
    } catch {
      // Directory doesn't exist or empty, ignore
    }
  }
}

/**
 * Create a file system storage instance
 */
export async function createFileSystemStorage(options: FileSystemStorageOptions): Promise<FileSystemStorage> {
  const storage = new FileSystemStorage(options);
  await storage.init();
  return storage;
}