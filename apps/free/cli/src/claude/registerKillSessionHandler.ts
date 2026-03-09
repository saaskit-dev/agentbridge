import { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager';
import { Logger } from '@agentbridge/core/telemetry';

const logger = new Logger('claude/registerKillSessionHandler');

interface KillSessionRequest {
  // No parameters needed
}

interface KillSessionResponse {
  success: boolean;
  message: string;
}

export function registerKillSessionHandler(
  rpcHandlerManager: RpcHandlerManager,
  killThisFree: () => Promise<void>
) {
  rpcHandlerManager.registerHandler<KillSessionRequest, KillSessionResponse>(
    'killSession',
    async () => {
      logger.debug('Kill session request received');

      // This will start the cleanup process
      void killThisFree();

      // We should still be able to respond the the client, though they
      // should optimistically assume the session is dead.
      return {
        success: true,
        message: 'Killing free-cli process',
      };
    }
  );
}
