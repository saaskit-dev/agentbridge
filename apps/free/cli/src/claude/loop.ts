import { MessageQueue2 } from '@/utils/MessageQueue2';
import { Logger, getCollector } from '@saaskit-dev/agentbridge/telemetry';
import { claudeLocalLauncher, LauncherResult } from './claudeLocalLauncher';
import { claudeRemoteLauncher } from './claudeRemoteLauncher';
import { ApiClient } from '@/lib';
import { Session } from './session';
import { ApiSessionClient } from '@/api/apiSession';
import type { EnhancedMode, JsRuntime, PermissionMode } from './sessionTypes';
import type { SandboxConfig } from '@/persistence';

export type { EnhancedMode, PermissionMode } from './sessionTypes';

const logger = new Logger('claude/loop');

interface LoopOptions {
  path: string;
  model?: string;
  permissionMode?: PermissionMode;
  startingMode?: 'local' | 'remote';
  onModeChange: (mode: 'local' | 'remote') => void;
  mcpServers: Record<string, any>;
  session: ApiSessionClient;
  api: ApiClient;
  claudeEnvVars?: Record<string, string>;
  claudeArgs?: string[];
  messageQueue: MessageQueue2<EnhancedMode>;
  allowedTools?: string[];
  sandboxConfig?: SandboxConfig;
  onSessionReady?: (session: Session) => void;
  /** Path to temporary settings file with SessionStart hook (required for session tracking) */
  hookSettingsPath: string;
  /** JavaScript runtime to use for spawning Claude Code (default: 'node') */
  jsRuntime?: JsRuntime;
  /** Function to check if pending exit is requested (e.g., from SIGTERM) */
  isPendingExit?: () => boolean;
}
export async function loop(opts: LoopOptions): Promise<number> {
  // Get log path for debug display
  const logPath = getCollector().getLogFilePath() ?? '';
  const session = new Session({
    api: opts.api,
    client: opts.session,
    path: opts.path,
    sessionId: null,
    claudeEnvVars: opts.claudeEnvVars,
    claudeArgs: opts.claudeArgs,
    mcpServers: opts.mcpServers,
    logPath: logPath,
    messageQueue: opts.messageQueue,
    allowedTools: opts.allowedTools,
    sandboxConfig: opts.sandboxConfig,
    onModeChange: opts.onModeChange,
    hookSettingsPath: opts.hookSettingsPath,
    jsRuntime: opts.jsRuntime,
  });

  opts.onSessionReady?.(session);

  const sessionId = opts.session.sessionId;
  let mode: 'local' | 'remote' = opts.startingMode ?? 'local';
  while (true) {
    logger.debug('[loop] Iteration', { mode, sessionId });

    // Check if pending exit is requested (e.g., from SIGTERM during CLI update)
    if (opts.isPendingExit?.()) {
      logger.debug('[loop] Pending exit requested, breaking loop', { sessionId });
      return 0;
    }

    switch (mode) {
      case 'local': {
        const result = await claudeLocalLauncher(session);
        switch (result.type) {
          case 'switch':
            mode = 'remote';
            opts.onModeChange?.(mode);
            break;
          case 'exit':
            return result.code;
          default:
            const _: never = result satisfies never;
        }
        break;
      }

      case 'remote': {
        const reason = await claudeRemoteLauncher(session);
        switch (reason) {
          case 'exit':
            return 0;
          case 'switch':
            mode = 'local';
            opts.onModeChange?.(mode);
            break;
          default:
            const _: never = reason satisfies never;
        }
        break;
      }

      default: {
        const _: never = mode satisfies never;
      }
    }
  }
}
