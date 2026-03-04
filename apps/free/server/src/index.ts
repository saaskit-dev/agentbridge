/**
 * @free/server
 * Free Standalone Server
 *
 * A complete reference server implementation for Free.
 * This package provides a production-ready server with:
 * - WebSocket server for real-time communication
 * - Token-based authentication
 * - Session management
 * - Message handling
 * - Machine management
 * - PostgreSQL persistence (optional)
 *
 * Usage:
 *   Run directly: pnpm start
 *   Or import: import { startApi } from '@free/server';
 */

// Main entry point
export { startApi } from './app/api/api';

// Storage
export { db } from './storage/db';

// Types
export { Context } from './context';
