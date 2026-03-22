/**
 * CLIRenderer — renders NormalizedMessage to the terminal.
 *
 * Works for all agent types (Claude, Codex, Gemini, OpenCode).
 * Dispatches on role: 'user' | 'agent' | 'event'.
 *
 * Features (Phase 5):
 *   - Chalk color coding: tool-call (cyan), tool-result errors (red), thinking (dim)
 *   - Sidechain (subagent) blocks: indented + dimmed
 *   - Status events: working/idle indicator
 *   - Token count events: optional footer
 *   - pty_data: write raw base64-decoded bytes to stdout (Claude local mode)
 *   - showThinking flag: toggleable via constructor option
 */

import chalk from 'chalk';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';
import type {
  NormalizedMessage,
  AgentEvent,
  AgentType,
  NormalizedAgentContent,
} from '@/daemon/sessions/types';

const logger = new Logger('client/CLIRenderer');

export interface CLIRendererOptions {
  agentType?: AgentType;
  /** Show <thinking> blocks. Default: false. */
  showThinking?: boolean;
  /** Show token usage after each turn. Default: false. */
  showTokenCount?: boolean;
}

export class CLIRenderer {
  private readonly showThinking: boolean;
  private readonly showTokenCount: boolean;

  constructor(private readonly opts: CLIRendererOptions = {}) {
    this.showThinking = opts.showThinking ?? false;
    this.showTokenCount = opts.showTokenCount ?? false;
  }

  /** Write raw PTY bytes from daemon (Claude local mode). */
  writePtyData(base64Data: string): void {
    process.stdout.write(Buffer.from(base64Data, 'base64'));
  }

  /** Render one NormalizedMessage to stdout/stderr. */
  render(msg: NormalizedMessage): void {
    if (msg.role === 'user') {
      process.stdout.write(`\n${chalk.green('>')} ${msg.content.text}\n`);
    } else if (msg.role === 'agent') {
      for (const block of msg.content) {
        this.renderAgentBlock(block, msg.isSidechain);
      }
    } else if (msg.role === 'event') {
      this.handleAgentEvent(msg.content);
    }
  }

  /** Replay history messages received immediately after attach. */
  onHistory(msgs: NormalizedMessage[]): void {
    logger.debug('[CLIRenderer] replaying history', { count: msgs.length });
    if (msgs.length > 0) {
      process.stdout.write(chalk.dim(`\n[resuming — replaying ${msgs.length} message(s)]\n`));
    }
    for (const msg of msgs) this.render(msg);
  }

  private renderAgentBlock(block: NormalizedAgentContent, isSidechain: boolean): void {
    const indent = isSidechain ? '  ' : '';

    switch (block.type) {
      case 'text': {
        const text = isSidechain ? chalk.dim(block.text) : block.text;
        process.stdout.write(indent + text);
        break;
      }

      case 'thinking': {
        if (!this.showThinking) break;
        process.stdout.write(
          chalk.dim(`\n${indent}<thinking>\n${indent}${block.thinking}\n${indent}</thinking>\n`)
        );
        break;
      }

      case 'tool-call': {
        const nameStr = chalk.cyan(`[${block.name}]`);
        let inputStr: string;
        try {
          inputStr = chalk.yellow(JSON.stringify(block.input, null, 2));
        } catch {
          inputStr = chalk.yellow(String(block.input));
        }
        process.stdout.write(`\n${indent}${nameStr} ${inputStr}\n`);
        break;
      }

      case 'tool-result': {
        if (block.is_error) {
          let errStr: string;
          try {
            errStr =
              typeof block.content === 'string' ? block.content : JSON.stringify(block.content);
          } catch {
            errStr = String(block.content);
          }
          process.stderr.write(`${indent}${chalk.red('[tool-error]')} ${errStr}\n`);
        } else {
          // Successful tool results are often large; print a dimmed one-liner
          const preview =
            typeof block.content === 'string'
              ? block.content.slice(0, 200)
              : (JSON.stringify(block.content)?.slice(0, 200) ?? '');
          if (preview) {
            process.stdout.write(chalk.dim(`${indent}✓ ${preview}\n`));
          }
        }
        break;
      }

      case 'summary': {
        process.stdout.write(chalk.dim(`\n${indent}[summary] ${block.summary}\n`));
        break;
      }

      case 'sidechain': {
        // Subagent invocation marker: show prompt with special prefix
        process.stdout.write(chalk.dim(`\n${indent}[subagent] ${block.prompt.slice(0, 120)}\n`));
        break;
      }
    }
  }

  private handleAgentEvent(event: AgentEvent): void {
    switch (event.type) {
      case 'ready':
        process.stdout.write(chalk.dim('\n[ready]\n'));
        break;

      case 'switch':
        process.stdout.write(chalk.blue(`\n[mode → ${event.mode}]\n`));
        break;

      case 'limit-reached':
        process.stderr.write(
          chalk.red(`\n[rate limited — resets at ${new Date(event.endsAt).toISOString()}]\n`)
        );
        break;

      case 'message':
        process.stdout.write(chalk.dim(`\n[${event.message}]\n`));
        break;

      case 'status':
        if (event.state === 'working') {
          process.stdout.write(chalk.dim('\n● working…\n'));
        } else {
          process.stdout.write(chalk.dim('\n○ idle\n'));
        }
        break;

      case 'token_count':
        if (this.showTokenCount) {
          const { input_tokens, output_tokens, cache_read_input_tokens } = event.usage;
          const cacheStr = cache_read_input_tokens ? ` cache_read=${cache_read_input_tokens}` : '';
          process.stdout.write(
            chalk.dim(`\n[tokens] in=${input_tokens} out=${output_tokens}${cacheStr}\n`)
          );
        }
        break;

      case 'error':
        process.stderr.write(chalk.red(`\n[agent error] ${event.message}\n`));
        break;
    }
  }
}
