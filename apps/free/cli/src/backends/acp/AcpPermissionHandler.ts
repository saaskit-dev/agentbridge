import { Logger } from '@saaskit-dev/agentbridge/telemetry';
import type { PermissionMode } from '@/api/types';
import { ApiSessionClient } from '@/api/apiSession';
import { BasePermissionHandler, PermissionResult } from '@/utils/BasePermissionHandler';
import { getPermissionModeForAgentMode } from '@/backends/acp/permissionModeMapping';
import { shouldAutoApprove } from '@/backends/acp/toolClassification';

const logger = new Logger('backends/acp/AcpPermissionHandler');

export class AcpPermissionHandler extends BasePermissionHandler {
  private requestedPermissionMode: PermissionMode;

  constructor(
    session: ApiSessionClient,
    private readonly agentType: string,
    private readonly getCurrentModeId: () => string | null,
    initialPermissionMode: PermissionMode = 'accept-edits'
  ) {
    super(session);
    this.requestedPermissionMode = initialPermissionMode;
    logger.info('ACP permission handler initialized', {
      initialPermissionMode,
      agentType,
    });
  }

  protected getLogPrefix(): string {
    return '[ACP]';
  }

  setRequestedPermissionMode(mode: PermissionMode): void {
    this.requestedPermissionMode = mode;
    logger.debug('Requested permission mode updated', { mode });
  }

  private getEffectivePermissionMode(): PermissionMode | null {
    const currentModeId = this.getCurrentModeId();

    if (!currentModeId) {
      return this.requestedPermissionMode;
    }

    return getPermissionModeForAgentMode(this.agentType, currentModeId) ?? this.requestedPermissionMode;
  }

  async handleToolCall(
    toolCallId: string,
    toolName: string,
    input: unknown
  ): Promise<PermissionResult> {
    const effectivePermissionMode = this.getEffectivePermissionMode();

    if (effectivePermissionMode && shouldAutoApprove(toolName, effectivePermissionMode)) {
      logger.debug('Auto-approving tool', {
        toolCallId,
        toolName,
        currentModeId: this.getCurrentModeId(),
        permissionMode: effectivePermissionMode,
      });
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
            decision: effectivePermissionMode === 'yolo' ? 'approved_for_session' : 'approved',
          },
        },
      }));
      return {
        decision: effectivePermissionMode === 'yolo' ? 'approved_for_session' : 'approved',
      };
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
        currentModeId: this.getCurrentModeId(),
        permissionMode: effectivePermissionMode,
        requestedPermissionMode: this.requestedPermissionMode,
      });
    });
  }
}
