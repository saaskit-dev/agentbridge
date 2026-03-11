import { Socket } from 'socket.io';
import { eventRouter } from '@/app/events/eventRouter';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';
import type { WireTrace } from '@saaskit-dev/agentbridge/telemetry';
const log = new Logger('app/api/socket/rpcHandler');

function extractWireTrace(data: any): WireTrace | undefined {
  if (data && typeof data._trace === 'object' && typeof data._trace.tid === 'string') {
    return data._trace as WireTrace;
  }
  return undefined;
}

export function rpcHandler(userId: string, socket: Socket, rpcListeners: Map<string, Socket>) {
  // RPC register - Register this socket as a listener for an RPC method
  socket.on('rpc-register', async (data: any) => {
    try {
      const { method } = data;

      if (!method || typeof method !== 'string') {
        socket.emit('rpc-error', { type: 'register', error: 'Invalid method name' });
        return;
      }

      // Check if method was already registered
      const previousSocket = rpcListeners.get(method);
      if (previousSocket && previousSocket !== socket) {
        // log.info(`RPC method ${method} re-registered: ${previousSocket.id} -> ${socket.id}`);
      }

      // Register this socket as the listener for this method
      rpcListeners.set(method, socket);

      socket.emit('rpc-registered', { method });
      // log.info(`RPC method registered: ${method} on socket ${socket.id} (user: ${userId})`);
      // log.info(`Active RPC methods for user ${userId}: ${Array.from(rpcListeners.keys()).join(', ')}`);
    } catch (error) {
      log.error(`Error in rpc-register: ${error}`);
      socket.emit('rpc-error', { type: 'register', error: 'Internal error' });
    }
  });

  // RPC unregister - Remove this socket as a listener for an RPC method
  socket.on('rpc-unregister', async (data: any) => {
    try {
      const { method } = data;

      if (!method || typeof method !== 'string') {
        socket.emit('rpc-error', { type: 'unregister', error: 'Invalid method name' });
        return;
      }

      if (rpcListeners.get(method) === socket) {
        rpcListeners.delete(method);
        // log.info(`RPC method unregistered: ${method} from socket ${socket.id} (user: ${userId})`);

        if (rpcListeners.size === 0) {
          rpcListeners.delete(userId);
          // log.info(`All RPC methods unregistered for user ${userId}`);
        } else {
          // log.info(`Remaining RPC methods for user ${userId}: ${Array.from(rpcListeners.keys()).join(', ')}`);
        }
      } else {
        // log.info(`RPC unregister ignored: ${method} not registered on socket ${socket.id}`);
      }

      socket.emit('rpc-unregistered', { method });
    } catch (error) {
      log.error(`Error in rpc-unregister: ${error}`);
      socket.emit('rpc-error', { type: 'unregister', error: 'Internal error' });
    }
  });

  // RPC call - Call an RPC method on another socket of the same user
  socket.on('rpc-call', async (data: any, callback: (response: any) => void) => {
    try {
      const { method, params } = data;

      if (!method || typeof method !== 'string') {
        if (callback) {
          callback({
            ok: false,
            error: 'Invalid parameters: method is required',
          });
        }
        return;
      }

      const targetSocket = rpcListeners.get(method);
      if (!targetSocket || !targetSocket.connected) {
        // log.info(`RPC call failed: Method ${method} not available (disconnected or not registered)`);
        if (callback) {
          callback({
            ok: false,
            error: 'RPC method not available',
          });
        }
        return;
      }

      // Don't allow calling your own socket
      if (targetSocket === socket) {
        // log.info(`RPC call failed: Attempted self-call on method ${method}`);
        if (callback) {
          callback({
            ok: false,
            error: 'Cannot call RPC on the same socket',
          });
        }
        return;
      }

      // Log RPC call initiation
      const startTime = Date.now();
      // log.info(`RPC call initiated: ${socket.id} -> ${method} (target: ${targetSocket.id})`);

      // Forward the RPC request to the target socket using emitWithAck
      // Pass _trace for cross-layer trace correlation (RFC §7.1)
      const trace = extractWireTrace(data);
      try {
        const response = await targetSocket.timeout(30000).emitWithAck('rpc-request', {
          method,
          params,
          ...(trace ? { _trace: trace } : {}),
        });

        const duration = Date.now() - startTime;
        // log.info(`RPC call succeeded: ${method} (${duration}ms)`);

        // Forward the response back to the caller via callback
        if (callback) {
          callback({
            ok: true,
            result: response,
          });
        }
      } catch (error) {
        const duration = Date.now() - startTime;
        const errorMsg = error instanceof Error ? error.message : 'RPC call failed';
        // log.info(`RPC call failed: ${method} - ${errorMsg} (${duration}ms)`);

        // Timeout or error occurred
        if (callback) {
          callback({
            ok: false,
            error: errorMsg,
          });
        }
      }
    } catch (error) {
      // log.error(`Error in rpc-call: ${error}`);
      if (callback) {
        callback({
          ok: false,
          error: 'Internal error',
        });
      }
    }
  });

  socket.on('disconnect', () => {
    const methodsToRemove: string[] = [];
    for (const [method, registeredSocket] of rpcListeners.entries()) {
      if (registeredSocket === socket) {
        methodsToRemove.push(method);
      }
    }

    if (methodsToRemove.length > 0) {
      // log.info(`Cleaning up RPC methods on disconnect for socket ${socket.id}: ${methodsToRemove.join(', ')}`);
      methodsToRemove.forEach(method => rpcListeners.delete(method));
    }

    if (rpcListeners.size === 0) {
      rpcListeners.delete(userId);
      // log.info(`All RPC listeners removed for user ${userId}`);
    }
  });
}
