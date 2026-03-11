/**
 * TransportHandler Interface
 *
 * Re-exports from @saaskit-dev/agentbridge with backward-compatible alias.
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
} from '@saaskit-dev/agentbridge';

export {
  registerTransportHandler,
  createTransportHandler,
  hasTransportHandler,
} from '@saaskit-dev/agentbridge';

// Backward-compatible alias
import type { ITransportHandler } from '@saaskit-dev/agentbridge';

/**
 * @deprecated Use ITransportHandler from @saaskit-dev/agentbridge
 */
export type TransportHandler = ITransportHandler;
