/**
 * @agentbridge/interfaces - KeyTree Interface
 * Hierarchical deterministic key derivation
 */

import type { KeyPair } from './crypto';

/**
 * KeyTree node representing a derived key
 */
export interface KeyTreeNode {
  /** The derived key */
  key: Uint8Array;
  /** Path to this node */
  path: string[];
  /** Child nodes */
  children: Map<string, KeyTreeNode>;
}

/**
 * KeyTree - Hierarchical deterministic key derivation
 *
 * Based on Happy's KeyTree implementation using HMAC-SHA512.
 * Provides deterministic key derivation from a master secret.
 *
 * Path examples:
 * - ['session', sessionId] → session-specific key
 * - ['machine', machineId] → machine-specific key
 * - ['artifact', artifactId] → artifact-specific key
 */
export interface IKeyTree {
  /**
   * Get or derive the root key
   */
  getRootKey(): Uint8Array;

  /**
   * Derive a key at the given path
   */
  derive(path: string[]): Uint8Array;

  /**
   * Derive a key pair at the given path
   */
  deriveKeyPair(path: string[]): KeyPair;

  /**
   * Get or create a child node
   */
  getChild(name: string): KeyTreeNode;

  /**
   * Clear the cache
   */
  clearCache(): void;

  /**
   * Get cached node count
   */
  getCacheSize(): number;
}

/**
 * KeyTree options
 */
export interface KeyTreeOptions {
  /** Master secret for key derivation */
  masterSecret: string | Uint8Array;
  /** Maximum cache size (default: 1000) */
  maxCacheSize?: number;
}

/**
 * KeyTree factory function type
 */
export type KeyTreeFactory = (options: KeyTreeOptions) => IKeyTree;

const keyTreeFactories = new Map<string, KeyTreeFactory>();

/**
 * Register a KeyTree factory
 */
export function registerKeyTreeFactory(type: string, factory: KeyTreeFactory): void {
  keyTreeFactories.set(type, factory);
}

/**
 * Create a KeyTree instance
 */
export function createKeyTree(options: KeyTreeOptions, type = 'default'): IKeyTree {
  const factory = keyTreeFactories.get(type);
  if (!factory) {
    throw new Error(`Unknown KeyTree type: ${type}. Available: ${getRegisteredKeyTreeTypes().join(', ')}`);
  }
  return factory(options);
}

/**
 * Get list of registered KeyTree types
 */
export function getRegisteredKeyTreeTypes(): string[] {
  return Array.from(keyTreeFactories.keys());
}
