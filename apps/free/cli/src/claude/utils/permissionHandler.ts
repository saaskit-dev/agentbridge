/**
 * Permission Handler for canCallTool integration
 *
 * Replaces the MCP permission server with direct SDK integration.
 * Handles tool permission requests, responses, and state management.
 */

import { isDeepStrictEqual } from 'node:util';
import type { EnhancedMode, PermissionMode } from '../sessionTypes';
import { SDKAssistantMessage, SDKMessage, SDKUserMessage } from '../sdk';
import { PLAN_FAKE_REJECT, PLAN_FAKE_RESTART } from '../sdk/prompts';
import { PermissionResult } from '../sdk/types';
import { ApiSessionClient } from '@/api/apiSession';
import { ApiClient } from '@/api/api';
import { getToolDescriptor } from './getToolDescriptor';
import { getToolName } from './getToolName';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';
import { delay } from '@/utils/time';

const logger = new Logger('claude/utils/permissionHandler');

interface PermissionResponse {
  id: string;
  approved: boolean;
  reason?: string;
  mode?: PermissionMode;
  allowTools?: string[];
  receivedAt?: number;
}

interface PendingRequest {
  resolve: (value: PermissionResult) => void;
  reject: (error: Error) => void;
  toolName: string;
  input: unknown;
  createdAt: number;
}

export interface PermissionHandlerOpts {
  /** ApiClient used for push notifications to background devices (optional in daemon mode). */
  api?: ApiClient;
  /**
   * Called when plan mode is approved. Implementor should inject PLAN_FAKE_RESTART at the
   * front of the message queue with the resolved permission mode.
   */
  onPlanApproved?: (message: string, mode: EnhancedMode) => void;
  /** Initial permission mode. Defaults to 'accept-edits'. */
  initialPermissionMode?: PermissionMode;
}

/** 30 分钟未响应的 pending request 自动标记为 denied */
const PENDING_REQUEST_TTL_MS = 30 * 60 * 1000;
/** 每 5 分钟扫描一次超时 pending requests */
const PENDING_REQUEST_GC_INTERVAL_MS = 5 * 60 * 1000;

export class PermissionHandler {
  private toolCalls: { id: string; name: string; input: any; used: boolean }[] = [];
  private responses = new Map<string, PermissionResponse>();
  private pendingRequests = new Map<string, PendingRequest>();
  private client: ApiSessionClient;
  private opts: PermissionHandlerOpts;
  private allowedTools = new Set<string>();
  private allowedBashLiterals = new Set<string>();
  private allowedBashPrefixes = new Set<string>();
  private permissionMode: PermissionMode;
  private onPermissionRequestCallback?: (toolCallId: string) => void;
  private gcTimer: ReturnType<typeof setInterval> | null = null;

  constructor(client: ApiSessionClient, opts: PermissionHandlerOpts = {}) {
    this.client = client;
    this.opts = opts;
    this.permissionMode = opts.initialPermissionMode ?? 'accept-edits';
    this.setupClientHandler();
    this.startGcTimer();
  }

  /**
   * 定期扫描并清理超过 30 分钟仍未响应的 pending requests，自动标记为 denied。
   * 防止 agent tool call 因用户长时间离开而永久挂起。
   */
  private startGcTimer(): void {
    this.gcTimer = setInterval(() => {
      const now = Date.now();
      for (const [id, pending] of this.pendingRequests.entries()) {
        if (now - pending.createdAt > PENDING_REQUEST_TTL_MS) {
          logger.warn('tool_permission_auto_denied_daemon_ttl', {
            sessionId: this.client.sessionId,
            permissionId: id,
            toolName: pending.toolName,
            pendingMs: now - pending.createdAt,
          });
          this.pendingRequests.delete(id);
          const response: PermissionResponse = { id, approved: false, reason: 'Permission request timed out after 30 minutes' };
          // 更新 agentState：将该请求移到 completedRequests
          this.client.updateAgentState(currentState => {
            const request = currentState.requests?.[id];
            const r = { ...currentState.requests };
            delete r[id];
            return {
              ...currentState,
              requests: r,
              completedRequests: {
                ...currentState.completedRequests,
                ...(request
                  ? {
                      [id]: {
                        ...request,
                        completedAt: now,
                        status: 'denied' as const,
                        reason: response.reason,
                      },
                    }
                  : {}),
              },
            };
          });
          this.handlePermissionResponse(response, pending);
        }
      }
    }, PENDING_REQUEST_GC_INTERVAL_MS);
  }

  /**
   * 停止 GC 定时器，在实例销毁时调用。
   */
  destroy(): void {
    if (this.gcTimer !== null) {
      clearInterval(this.gcTimer);
      this.gcTimer = null;
    }
  }

  /**
   * Update the session reference after an offline reconnection swaps the ApiSessionClient.
   */
  updateSession(newClient: ApiSessionClient): void {
    this.client = newClient;
    this.setupClientHandler();
  }

  /**
   * Set callback to trigger when permission request is made
   */
  setOnPermissionRequest(callback: (toolCallId: string) => void) {
    this.onPermissionRequestCallback = callback;
  }

  handleModeChange(mode: PermissionMode) {
    this.permissionMode = mode;
  }

  /**
   * Handler response
   */
  private handlePermissionResponse(response: PermissionResponse, pending: PendingRequest): void {
    // Update allowed tools
    if (response.allowTools && response.allowTools.length > 0) {
      response.allowTools.forEach(tool => {
        if (tool.startsWith('Bash(') || tool === 'Bash') {
          this.parseBashPermission(tool);
        } else {
          this.allowedTools.add(tool);
        }
      });
    }

    // Update permission mode
    if (response.mode) {
      this.permissionMode = response.mode;
    }

    // Handle
    if (pending.toolName === 'exit_plan_mode' || pending.toolName === 'ExitPlanMode') {
      // Handle exit_plan_mode specially
      logger.debug('Plan mode result received', response);
      if (response.approved) {
        logger.debug('Plan approved - injecting PLAN_FAKE_RESTART');
        // Inject the approval message at the beginning of the queue
        this.opts.onPlanApproved?.(PLAN_FAKE_RESTART, {
          permissionMode: response.mode ?? 'accept-edits',
        });
        pending.resolve({ behavior: 'deny', message: PLAN_FAKE_REJECT });
      } else {
        pending.resolve({ behavior: 'deny', message: response.reason || 'Plan rejected' });
      }
    } else {
      // Handle default case for all other tools
      const result: PermissionResult = response.approved
        ? { behavior: 'allow', updatedInput: (pending.input as Record<string, unknown>) || {} }
        : {
            behavior: 'deny',
            message:
              response.reason ||
              `The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.`,
          };

      pending.resolve(result);
    }
  }

  /**
   * Creates the canCallTool callback for the SDK
   */
  handleToolCall = async (
    toolName: string,
    input: unknown,
    mode: EnhancedMode,
    options: { signal: AbortSignal }
  ): Promise<PermissionResult> => {
    // Check if tool is explicitly allowed
    if (toolName === 'Bash') {
      const inputObj = input as { command?: string };
      if (inputObj?.command) {
        // Check literal matches
        if (this.allowedBashLiterals.has(inputObj.command)) {
          return { behavior: 'allow', updatedInput: input as Record<string, unknown> };
        }
        // Check prefix matches
        for (const prefix of this.allowedBashPrefixes) {
          if (inputObj.command.startsWith(prefix)) {
            return { behavior: 'allow', updatedInput: input as Record<string, unknown> };
          }
        }
      }
    } else if (this.allowedTools.has(toolName)) {
      return { behavior: 'allow', updatedInput: input as Record<string, unknown> };
    }

    // Calculate descriptor
    const descriptor = getToolDescriptor(toolName);

    //
    // Handle special cases
    //

    if (this.permissionMode === 'yolo') {
      return { behavior: 'allow', updatedInput: input as Record<string, unknown> };
    }

    if (this.permissionMode === 'accept-edits' && descriptor.edit) {
      return { behavior: 'allow', updatedInput: input as Record<string, unknown> };
    }

    //
    // Approval flow
    //

    let toolCallId = this.resolveToolCallId(toolName, input);
    if (!toolCallId) {
      // What if we got permission before tool call
      logger.debug('[permissionHandler] toolCallId not found, retrying after 1s', { toolName });
      await delay(1000);
      toolCallId = this.resolveToolCallId(toolName, input);
      if (!toolCallId) {
        logger.error('[permissionHandler] toolCallId resolution failed after retry', undefined, {
          toolName,
        });
        throw new Error(`Could not resolve tool call ID for ${toolName}`);
      }
    }
    logger.debug('[permissionHandler] starting permission request', {
      toolCallId,
      toolName,
      permissionMode: this.permissionMode,
    });
    return this.handlePermissionRequest(toolCallId, toolName, input, options.signal);
  };

  /**
   * Handles individual permission requests
   */
  private async handlePermissionRequest(
    id: string,
    toolName: string,
    input: unknown,
    signal: AbortSignal
  ): Promise<PermissionResult> {
    return new Promise<PermissionResult>((resolve, reject) => {
      // Set up abort signal handling
      const abortHandler = () => {
        this.pendingRequests.delete(id);
        reject(new Error('Permission request aborted'));
      };
      signal.addEventListener('abort', abortHandler, { once: true });

      // Store the pending request
      this.pendingRequests.set(id, {
        resolve: (result: PermissionResult) => {
          signal.removeEventListener('abort', abortHandler);
          resolve(result);
        },
        reject: (error: Error) => {
          signal.removeEventListener('abort', abortHandler);
          reject(error);
        },
        toolName,
        input,
        createdAt: Date.now(),
      });

      // Trigger callback to send delayed messages immediately
      if (this.onPermissionRequestCallback) {
        this.onPermissionRequestCallback(id);
      }

      // Send push notification (optional — skipped in daemon mode when no ApiClient is provided)
      this.opts.api
        ?.push()
        .sendToAllDevices('Permission Request', `Claude wants to ${getToolName(toolName)}`, {
          sessionId: this.client.sessionId,
          requestId: id,
          tool: toolName,
          type: 'permission_request',
        });

      // Update agent state
      this.client.updateAgentState(currentState => ({
        ...currentState,
        requests: {
          ...currentState.requests,
          [id]: {
            tool: toolName,
            arguments: input,
            createdAt: Date.now(),
          },
        },
      }));

      logger.debug(`Permission request sent for tool call ${id}: ${toolName}`);
    });
  }

  /**
   * Parses Bash permission strings into literal and prefix sets
   */
  private parseBashPermission(permission: string): void {
    // Ignore plain "Bash"
    if (permission === 'Bash') {
      return;
    }

    // Match Bash(command) or Bash(command:*)
    const bashPattern = /^Bash\((.+?)\)$/;
    const match = permission.match(bashPattern);

    if (!match) {
      return;
    }

    const command = match[1];

    // Check if it's a prefix pattern (ends with :*)
    if (command.endsWith(':*')) {
      const prefix = command.slice(0, -2); // Remove :*
      this.allowedBashPrefixes.add(prefix);
    } else {
      // Literal match
      this.allowedBashLiterals.add(command);
    }
  }

  /**
   * Resolves tool call ID based on tool name and input
   */
  private resolveToolCallId(name: string, args: any): string | null {
    // Search in reverse (most recent first)
    for (let i = this.toolCalls.length - 1; i >= 0; i--) {
      const call = this.toolCalls[i];
      if (call.name === name && isDeepStrictEqual(call.input, args)) {
        if (call.used) {
          return null;
        }
        // Found unused match - mark as used and return
        call.used = true;
        return call.id;
      }
    }

    return null;
  }

  /**
   * Handles messages to track tool calls
   */
  onMessage(message: SDKMessage): void {
    if (message.type === 'assistant') {
      const assistantMsg = message as SDKAssistantMessage;
      if (assistantMsg.message && assistantMsg.message.content) {
        for (const block of assistantMsg.message.content) {
          if (block.type === 'tool_use') {
            this.toolCalls.push({
              id: block.id!,
              name: block.name!,
              input: block.input,
              used: false,
            });
          }
        }
      }
    }
    if (message.type === 'user') {
      const userMsg = message as SDKUserMessage;
      if (userMsg.message && userMsg.message.content && Array.isArray(userMsg.message.content)) {
        for (const block of userMsg.message.content) {
          if (block.type === 'tool_result' && block.tool_use_id) {
            const toolCall = this.toolCalls.find(tc => tc.id === block.tool_use_id);
            if (toolCall && !toolCall.used) {
              toolCall.used = true;
            }
          }
        }
      }
    }
  }

  /**
   * Checks if a tool call is rejected
   */
  isAborted(toolCallId: string): boolean {
    // If tool not approved, it's aborted
    if (this.responses.get(toolCallId)?.approved === false) {
      return true;
    }

    // Always abort exit_plan_mode
    const toolCall = this.toolCalls.find(tc => tc.id === toolCallId);
    if (toolCall && (toolCall.name === 'exit_plan_mode' || toolCall.name === 'ExitPlanMode')) {
      return true;
    }

    // Tool call is not aborted
    return false;
  }

  /**
   * Resets all state for new sessions
   */
  reset(): void {
    this.toolCalls = [];
    this.responses.clear();
    this.allowedTools.clear();
    this.allowedBashLiterals.clear();
    this.allowedBashPrefixes.clear();

    // Cancel all pending requests
    for (const [, pending] of this.pendingRequests.entries()) {
      pending.reject(new Error('Session reset'));
    }
    this.pendingRequests.clear();

    // Move all pending requests to completedRequests with canceled status
    this.client.updateAgentState(currentState => {
      const pendingRequests = currentState.requests || {};
      const completedRequests = { ...currentState.completedRequests };

      // Move each pending request to completed with canceled status
      for (const [id, request] of Object.entries(pendingRequests)) {
        completedRequests[id] = {
          ...request,
          completedAt: Date.now(),
          status: 'canceled',
          reason: 'Session switched to local mode',
        };
      }

      return {
        ...currentState,
        requests: {}, // Clear all pending requests
        completedRequests,
      };
    });
  }

  /**
   * Sets up the client handler for permission responses
   */
  private setupClientHandler(): void {
    this.client.rpcHandlerManager.registerHandler<PermissionResponse, void>(
      'permission',
      async message => {
        logger.debug(`Permission response: ${JSON.stringify(message)}`);

        const id = message.id;
        const pending = this.pendingRequests.get(id);

        if (!pending) {
          logger.debug('Permission request not found or already resolved');
          return;
        }

        // Store the response with timestamp
        this.responses.set(id, { ...message, receivedAt: Date.now() });
        this.pendingRequests.delete(id);

        // Handle the permission response based on tool type
        this.handlePermissionResponse(message, pending);

        // Move processed request to completedRequests
        this.client.updateAgentState(currentState => {
          const request = currentState.requests?.[id];
          if (!request) return currentState;
          const r = { ...currentState.requests };
          delete r[id];
          return {
            ...currentState,
            requests: r,
            completedRequests: {
              ...currentState.completedRequests,
              [id]: {
                ...request,
                completedAt: Date.now(),
                status: message.approved ? 'approved' : 'denied',
                reason: message.reason,
                mode: message.mode,
                allowTools: message.allowTools,
              },
            },
          };
        });
      }
    );
  }

  /**
   * Gets the responses map (for compatibility with existing code)
   */
  getResponses(): Map<string, PermissionResponse> {
    return this.responses;
  }
}
