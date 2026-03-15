import { Logger } from '@saaskit-dev/agentbridge/telemetry';
import type { PermissionMode } from '@/api/types';
import { ApiSessionClient } from '@/api/apiSession';
import { BasePermissionHandler, PermissionResult } from '@/utils/BasePermissionHandler';

const logger = new Logger('backends/acp/AcpPermissionHandler');

export class AcpPermissionHandler extends BasePermissionHandler {
  private currentPermissionMode: PermissionMode;

  constructor(session: ApiSessionClient, initialPermissionMode: PermissionMode = 'accept-edits') {
    super(session);
    this.currentPermissionMode = initialPermissionMode;
    logger.info('ACP permission handler initialized', {
      initialPermissionMode,
    });
  }

  protected getLogPrefix(): string {
    return '[ACP]';
  }

  setPermissionMode(mode: PermissionMode): void {
    this.currentPermissionMode = mode;
    logger.debug('Permission mode updated', { mode });
  }

  async handleToolCall(
    toolCallId: string,
    toolName: string,
    input: unknown
  ): Promise<PermissionResult> {
    if (this.currentPermissionMode === 'yolo') {
      logger.debug('Auto-approving tool in yolo mode', { toolCallId, toolName });
      this.session.updateAgentState(currentState => ({
        ...currentState,
        completedRequests: {
          ...currentState.completedRequests,
          [toolCallId]: {
            tool: toolName,
            arguments: input,
            createdAt: Date.now(),
            completedAt: Date.now(),
            status: 'approved',
            decision: 'approved_for_session',
          },
        },
      }));
      return { decision: 'approved_for_session' };
    }

    return new Promise<PermissionResult>((resolve, reject) => {
      this.pendingRequests.set(toolCallId, {
        resolve,
        reject,
        toolName,
        input,
      });

      this.addPendingRequestToState(toolCallId, toolName, input);
      logger.debug('Permission request sent to app', {
        toolCallId,
        toolName,
        permissionMode: this.currentPermissionMode,
      });
    });
  }
}
