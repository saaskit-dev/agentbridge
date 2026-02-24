/**
 * @agentbridge/interfaces - Sync Interface
 * InvalidateSync pattern for data synchronization
 */

import type { Session, SessionOptions, Message } from '@agentbridge/types';
import type { Machine } from '@agentbridge/types';
import type { ITransport } from './transport';
import type { UpdatePayload, EphemeralPayload } from './event';

/**
 * Sync events
 */
export interface SyncEvents {
  // Session events
  'sessions:invalidated': () => void;
  'sessions:updated': (sessions: Session[]) => void;
  'session:created': (session: Session) => void;
  'session:updated': (session: Session) => void;
  'session:deleted': (sessionId: string) => void;

  // Machine events
  'machines:invalidated': () => void;
  'machines:updated': (machines: Machine[]) => void;
  'machine:created': (machine: Machine) => void;
  'machine:updated': (machine: Machine) => void;
  'machine:deleted': (machineId: string) => void;

  // Message events
  'messages:received': (message: Message) => void;
  'messages:invalidated': (sessionId: string) => void;

  // Update events (from server)
  'update': (payload: UpdatePayload) => void;

  // Ephemeral events
  'ephemeral': (payload: EphemeralPayload) => void;
  'activity': (sessionId: string, active: boolean, thinking?: boolean) => void;
  'machine-activity': (machineId: string, active: boolean) => void;
  'usage': (sessionId: string, tokens: Record<string, number>, cost: Record<string, number>) => void;
  'machine-status': (machineId: string, online: boolean) => void;
}

/**
 * IInvalidateSync - Cache invalidation pattern for data sync
 *
 * Implementations can use:
 * - WebSocket-based (current)
 * - HTTP polling
 * - Offline-first with local storage
 * - Mock for testing
 */
export interface IInvalidateSync<T> {
  /**
   * Start watching for invalidation signals
   */
  start(): void;

  /**
   * Stop watching
   */
  stop(): void;

  /**
   * Force invalidate and refetch
   */
  invalidate(): Promise<T>;

  /**
   * Fetch data
   */
  fetch(): Promise<T>;

  /**
   * Get cached data
   */
  getData(): T | null;

  /**
   * Check if running
   */
  isRunning(): boolean;

  /**
   * Check if stopped
   */
  isStopped(): boolean;

  /**
   * Subscribe to updated event
   */
  on(event: 'updated', handler: (data: T) => void): void;

  /**
   * Subscribe to error event
   */
  on(event: 'error', handler: (error: Error) => void): void;

  /**
   * Unsubscribe from event
   */
  off(event: 'updated' | 'error', handler: (...args: unknown[]) => void): void;
}

/**
 * ISyncEngine - Main synchronization engine
 *
 * Implementations can use:
 * - WebSocket-based (current)
 * - HTTP polling
 * - Offline-first with local storage
 * - Mock for testing
 */
export interface ISyncEngine {
  /**
   * Start the sync engine
   */
  start(): void;

  /**
   * Stop the sync engine
   */
  stop(): void;

  /**
   * Check if running
   */
  isRunning(): boolean;

  // Session operations
  /**
   * Get all sessions
   */
  getSessions(): Promise<Session[]>;

  /**
   * Get a session by ID
   */
  getSession(sessionId: string): Promise<Session | null>;

  /**
   * Create a session
   */
  createSession(machineId: string, options: SessionOptions): Promise<Session>;

  /**
   * Delete a session
   */
  deleteSession(sessionId: string): Promise<void>;

  // Machine operations
  /**
   * Get all machines
   */
  getMachines(): Promise<Machine[]>;

  // Message operations
  /**
   * Get messages for a session
   */
  getMessages(sessionId: string): Promise<Message[]>;

  /**
   * Send a message to a session
   */
  sendMessage(sessionId: string, content: string): Promise<void>;

  // Activity operations
  /**
   * Send activity status
   */
  sendActivity(sessionId: string, active: boolean, thinking?: boolean): Promise<void>;

  /**
   * Send machine activity status
   */
  sendMachineActivity(machineId: string, active: boolean): Promise<void>;

  // Usage operations
  /**
   * Send usage data
   */
  sendUsage(sessionId: string, tokens: Record<string, number>, cost: Record<string, number>): Promise<void>;

  /**
   * Send machine status
   */
  sendMachineStatus(machineId: string, online: boolean): Promise<void>;

  // Event subscription
  /**
   * Subscribe to sync events
   */
  on<E extends keyof SyncEvents>(event: E, handler: SyncEvents[E]): void;

  /**
   * Unsubscribe from sync events
   */
  off<E extends keyof SyncEvents>(event: E, handler: SyncEvents[E]): void;
}

/**
 * Sync engine factory function type
 */
export type SyncEngineFactory = (transport: ITransport) => ISyncEngine;

const syncEngineFactories = new Map<string, SyncEngineFactory>();

/**
 * Register a sync engine factory
 */
export function registerSyncEngineFactory(type: string, factory: SyncEngineFactory): void {
  syncEngineFactories.set(type, factory);
}

/**
 * Create a sync engine instance
 */
export function createSyncEngineInstance(type = 'default', transport: ITransport): ISyncEngine {
  const factory = syncEngineFactories.get(type);
  if (!factory) {
    throw new Error(`Unknown sync engine type: ${type}. Available: ${getRegisteredSyncEngineTypes().join(', ')}`);
  }
  return factory(transport);
}

/**
 * Get list of registered sync engine types
 */
export function getRegisteredSyncEngineTypes(): string[] {
  return Array.from(syncEngineFactories.keys());
}

/**
 * Clear all registered sync engine factories (for testing)
 */
export function clearSyncEngineFactories(): void {
  syncEngineFactories.clear();
}
