/**
 * TransportHandler Interface
 *
 * Re-exports from @agentbridge/core with backward-compatible alias.
 *
 * @module TransportHandler
 */

// Re-export everything from core
export type {
  ITransportHandler,
  ToolPattern,
  StderrContext,
  StderrResult,
  ToolNameContext,
  TransportHandlerFactory,
} from '@agentbridge/core';

export {
  registerTransportHandler,
  createTransportHandler,
  hasTransportHandler,
} from '@agentbridge/core';

// Backward-compatible alias
import type { ITransportHandler } from '@agentbridge/core';

/**
 * @deprecated Use ITransportHandler from @agentbridge/core
 */
export type TransportHandler = ITransportHandler;
