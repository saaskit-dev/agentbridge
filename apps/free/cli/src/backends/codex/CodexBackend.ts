/**
 * CodexBackend — AgentBackend implementation for Codex (OpenAI).
 *
 * Wraps CodexMcpClient and translates raw Codex events to NormalizedMessage.
 *
 * Protocol:
 *   start()       → connect CodexMcpClient, register event handler
 *   sendMessage() → startSession() on first message, continueSession() thereafter
 *   abort()       → disconnect (CodexMCP has no dedicated abort tool)
 *   stop()        → forceCloseSession() + output.end()
 */

import { CodexMcpClient } from '@/codex/codexMcpClient';
import { resolveCodexExecutionPolicy } from '@/codex/executionPolicy';
import { CodexPermissionHandler } from '@/codex/utils/permissionHandler';
import { PushableAsyncIterable } from '@/utils/PushableAsyncIterable';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';
import { safeStringify } from '@saaskit-dev/agentbridge';
import { CHANGE_TITLE_INSTRUCTION } from '@/gemini/constants';
import type { ApiSessionClient } from '@/api/apiSession';
import type { AgentBackend, AgentStartOpts, BackendExitInfo } from '@/daemon/sessions/AgentBackend';
import type { NormalizedMessage } from '@/daemon/sessions/types';
import { mapCodexRawToNormalized } from './mapCodexRawToNormalized';

const logger = new Logger('backends/codex/CodexBackend');

export class CodexBackend implements AgentBackend {
  readonly agentType = 'codex' as const;
  readonly output = new PushableAsyncIterable<NormalizedMessage>();
  exitInfo?: BackendExitInfo;

  private client!: CodexMcpClient;
  private permissionHandler: CodexPermissionHandler | null = null;
  private startOpts!: AgentStartOpts;
  private sessionCreated = false;

  async start(opts: AgentStartOpts): Promise<void> {
    this.startOpts = opts;
    this.client = new CodexMcpClient();
    this.permissionHandler = new CodexPermissionHandler(opts.session);
    this.client.setPermissionHandler(this.permissionHandler);
    await this.client.connect();
    this.client.setHandler((raw: Record<string, unknown>) => {
      if (process.env.APP_ENV === 'development') {
        logger.debug('[CodexBackend] raw event', { raw });
      }
      const normalized = mapCodexRawToNormalized(raw);
      if (normalized) this.output.push(normalized);
    });
    logger.debug('[CodexBackend] started', { cwd: opts.cwd });
  }

  onSessionChange(newSession: ApiSessionClient): void {
    this.permissionHandler?.updateSession(newSession);
  }

  async sendMessage(text: string): Promise<void> {
    if (!this.sessionCreated) {
      const permissionMode = this.startOpts.permissionMode ?? 'read-only';
      const { approvalPolicy, sandbox } = resolveCodexExecutionPolicy(
        permissionMode,
        this.client.sandboxEnabled
      );

      const sessionConfig = {
        prompt: `${CHANGE_TITLE_INSTRUCTION}\n\n${text}`,
        'approval-policy': approvalPolicy,
        sandbox,
        cwd: this.startOpts.cwd,
        ...(this.startOpts.model ? { model: this.startOpts.model } : {}),
        ...(this.startOpts.mcpServerUrl
          ? {
              config: {
                mcpServers: {
                  free: { url: this.startOpts.mcpServerUrl },
                },
              },
            }
          : {}),
      };

      logger.debug('[CodexBackend] creating session', { cwd: this.startOpts.cwd, model: this.startOpts.model, approvalPolicy, sandbox });
      await this.client.startSession(sessionConfig);
      this.sessionCreated = true;
      logger.debug('[CodexBackend] session created');
    } else {
      logger.debug('[CodexBackend] continuing session', { preview: text.slice(0, 100) });
      await this.client.continueSession(text);
      logger.debug('[CodexBackend] continueSession completed');
    }
  }

  async abort(): Promise<void> {
    logger.debug('[CodexBackend] abort — disconnecting client');
    await this.client.disconnect().catch((err) => {
      logger.warn('[CodexBackend] error during abort disconnect', { error: safeStringify(err) });
      this.exitInfo = { reason: `abort disconnect error: ${safeStringify(err)}` };
    });
  }

  async stop(): Promise<void> {
    logger.debug('[CodexBackend] stop — force closing session');
    this.permissionHandler?.reset();
    await this.client.forceCloseSession().catch((err) => {
      logger.warn('[CodexBackend] error during stop', { error: safeStringify(err) });
      this.exitInfo = { reason: `stop error: ${safeStringify(err)}` };
    });
    if (!this.exitInfo) {
      this.exitInfo = { reason: 'stopped gracefully' };
    }
    logger.info('[CodexBackend] backend stopped', { reason: this.exitInfo.reason });
    this.output.end();
  }
}
