/**
 * Claude Backend - Native Claude Code integration
 *
 * This is a simplified stub implementation. For full Claude Code support,
 * this would integrate with @anthropic-ai/claude-code SDK.
 */

import type {
  IAgentBackend,
  AgentMessage,
  AgentMessageHandler,
  StartSessionResult,
  SessionId,
  PromptContentBlock,
} from '../../interfaces/agent';
import { registerAgentFactory } from '../../interfaces/agent';
import type { IProcessManager, IProcess } from '../../interfaces/process';
import { createProcessManager } from '../../interfaces/process';
import type { AgentBackendConfig } from '../../types/agent';

/**
 * Claude Backend - integrates with Claude Code CLI
 */
class ClaudeBackend implements IAgentBackend {
  private config: AgentBackendConfig;
  private processManager: IProcessManager;
  private process: IProcess | null = null;
  private messageHandlers: Set<AgentMessageHandler> = new Set();
  // Session tracking for potential future use
  private running = false;

  constructor(config: AgentBackendConfig) {
    this.config = config;
    this.processManager = createProcessManager('node');
  }

  async startSession(initialPrompt?: string): Promise<StartSessionResult> {
    const sessionId = this.generateSessionId();
    // sessionId available for future session tracking

    // Build Claude CLI arguments
    const args = ['--print', '--output-format', 'stream-json'];

    // Add permission mode if specified
    // This would be mapped from config to Claude CLI flags

    // Spawn Claude process
    this.process = this.processManager.spawn('claude', args, {
      cwd: this.config.cwd,
      env: {
        ...(Object.fromEntries(
          Object.entries(process.env).filter(([, v]) => v !== undefined)
        ) as Record<string, string>),
        ...this.config.env,
      },
    });

    this.running = true;

    // Start processing output
    this.processOutput();

    // Send initial prompt if provided
    if (initialPrompt) {
      await this.sendPrompt(sessionId, [{ type: 'text', text: initialPrompt }]);
    }

    this.emitMessage({
      type: 'status',
      status: 'starting',
    });

    return { sessionId };
  }

  async sendPrompt(_sessionId: SessionId, prompt: PromptContentBlock[]): Promise<void> {
    if (!this.process || !this.running) {
      throw new Error('Session not started');
    }

    // Extract text from content blocks and send via stdin
    const text = prompt
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map(b => b.text)
      .join('\n');
    this.process.stdin.write(text + '\n');
  }

  async cancel(_sessionId: SessionId): Promise<void> {
    if (this.process) {
      this.process.kill('SIGTERM');
    }
    this.running = false;
    this.emitMessage({
      type: 'status',
      status: 'stopped',
      detail: 'Cancelled by user',
    });
  }

  onMessage(handler: AgentMessageHandler): void {
    this.messageHandlers.add(handler);
  }

  offMessage(handler: AgentMessageHandler): void {
    this.messageHandlers.delete(handler);
  }

  async respondToPermission(requestId: string, approved: boolean): Promise<void> {
    // Claude Code uses MCP for permissions
    // This would integrate with the MCP permission server
    this.emitMessage({
      type: 'permission-response',
      id: requestId,
      approved,
    });
  }

  async dispose(): Promise<void> {
    if (this.process) {
      this.process.kill();
      await this.process.wait().catch(() => {});
      this.process = null;
    }
    this.running = false;
    this.messageHandlers.clear();
  }

  private emitMessage(message: AgentMessage): void {
    for (const handler of this.messageHandlers) {
      try {
        handler(message);
      } catch {
        // Ignore handler errors
      }
    }
  }

  private async processOutput(): Promise<void> {
    if (!this.process) return;

    // Process stdout
    (async () => {
      try {
        for await (const line of this.process!.stdout) {
          if (!this.running) break;
          this.handleOutputLine(line);
        }
      } catch {
        // Stream ended
      }
    })();

    // Process stderr
    (async () => {
      try {
        for await (const line of this.process!.stderr) {
          if (!this.running) break;
          this.emitMessage({
            type: 'terminal-output',
            data: line,
          });
        }
      } catch {
        // Stream ended
      }
    })();

    // Wait for process to exit
    const result = await this.process.wait();
    this.running = false;
    this.emitMessage({
      type: 'status',
      status: result.code === 0 ? 'stopped' : 'error',
      detail:
        result.code === 0 ? 'Process exited normally' : `Process exited with code ${result.code}`,
    });
  }

  private handleOutputLine(line: string): void {
    if (!line.trim()) return;

    try {
      // Claude outputs JSON lines in stream-json format
      const parsed = JSON.parse(line);
      this.handleClaudeMessage(parsed);
    } catch {
      // Not JSON, emit as terminal output
      this.emitMessage({
        type: 'terminal-output',
        data: line,
      });
    }
  }

  private handleClaudeMessage(msg: Record<string, unknown>): void {
    // Convert Claude stream-json format to AgentMessage
    const msgType = msg.type as string;

    if (msgType === 'assistant') {
      const content = msg.message as Record<string, unknown>;
      const textContent = content?.content as Array<Record<string, unknown>> | undefined;

      if (textContent) {
        for (const block of textContent) {
          if (block.type === 'text') {
            this.emitMessage({
              type: 'model-output',
              fullText: block.text as string,
            });
          } else if (block.type === 'tool_use') {
            this.emitMessage({
              type: 'tool-call',
              toolName: block.name as string,
              args: block.input as Record<string, unknown>,
              callId: block.id as string,
            });
          }
        }
      }
    } else if (msgType === 'tool_result') {
      this.emitMessage({
        type: 'tool-result',
        toolName: (msg.tool_name as string) ?? 'unknown',
        result: msg.content,
        callId: msg.tool_use_id as string,
      });
    } else if (msgType === 'permission_request') {
      this.emitMessage({
        type: 'permission-request',
        id: msg.id as string,
        reason: msg.reason as string,
        payload: msg,
      });
    }
  }

  private generateSessionId(): string {
    return `claude-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }
}

// Register factory
registerAgentFactory('claude', config => new ClaudeBackend(config));

// Export for direct use
export { ClaudeBackend };
