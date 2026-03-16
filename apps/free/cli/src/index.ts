#!/usr/bin/env node

/**
 * CLI entry point for free command
 *
 * Simple argument parsing without any CLI framework dependencies
 */

import { initCliTelemetry, shutdownTelemetry } from './telemetry';
initCliTelemetry();

import { execFileSync } from 'node:child_process';
import chalk from 'chalk';
import { z } from 'zod';
import packageJson from '../package.json';
import { uninstall } from './daemon/uninstall';
import { ApiClient } from './api/api';
import { runDoctorCommand } from './ui/doctor';
import { listDaemonSessions, stopDaemonSession } from './daemon/controlClient';
import { handleAuthCommand } from './commands/auth';
import { handleConnectCommand } from './commands/connect';
import { handleSandboxCommand } from './commands/sandbox';
import { handleAnalyticsCommand } from './commands/analytics';
import { spawnFreeCLI } from './utils/spawnFreeCLI';
import { claudeCliPath } from './claude/claudeLocal';
import {
  checkIfDaemonRunningAndCleanupStaleState,
  isDaemonRunningCurrentlyInstalledFreeVersion,
} from './daemon/controlClient';
import { killRunawayFreeProcesses } from './daemon/doctor';
import { install } from './daemon/install';
import { startDaemon } from './daemon/run';
import {
  startDaemonService,
  stopDaemonService,
  isDaemonServiceInstalled,
} from './daemon/serviceControl';
import { readCredentials, readSettings } from './persistence';
import { authAndSetupMachineIfNeeded } from './ui/auth';
import { getLatestDaemonLog } from './utils/daemonLogs';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';
import { exportDiagnostic } from '@saaskit-dev/agentbridge/telemetry/node';
import { safeStringify } from '@saaskit-dev/agentbridge';
import { configuration } from '@/configuration';
import { extractNoSandboxFlag } from './utils/sandboxFlags';
import { runWithDaemonIPC } from '@/client/CLIClient';
import { IPCClient } from '@/daemon/ipc/IPCClient';
import type { IPCServerMessage } from '@/daemon/ipc/protocol';
import { resolveInitialClaudePermissionMode, applySandboxPermissionPolicy } from '@/claude/utils/permissionMode';
import type { PermissionMode } from '@/api/types';

interface StartOptions {
  model?: string;
  permissionMode?: PermissionMode;
  startingMode?: 'local' | 'remote';
  claudeEnvVars?: Record<string, string>;
  claudeArgs?: string[];
  startedBy?: 'cli' | 'daemon' | 'app';
  noSandbox?: boolean;
  jsRuntime?: 'node' | 'bun';
  resumeSessionId?: string;
  attachSessionId?: string;
}

const logger = new Logger('index');
// Flush telemetry before exit (beforeExit fires for async, exit is sync-only)
process.on('beforeExit', () => { shutdownTelemetry().catch(() => {}); });

/**
 * Ensure the daemon is running and matches our CLI version.
 *
 * If a LaunchAgent is installed, it's already managing the daemon lifecycle
 * (KeepAlive will restart on crash). We just wait for it to become ready.
 * Otherwise, spawn start-sync directly with current env (FREE_HOME_DIR, APP_ENV).
 */
async function ensureDaemonRunning(): Promise<void> {
  logger.debug('checking if daemon is running with current version...');
  if (await isDaemonRunningCurrentlyInstalledFreeVersion()) {
    logger.debug('daemon already running with matching version');
    return;
  }

  const launchAgentInstalled = isDaemonServiceInstalled();
  logger.debug('daemon not running/version mismatch', { launchAgentInstalled });

  // Only spawn directly if no LaunchAgent is managing the daemon.
  // If LaunchAgent is installed, it's already trying to start the daemon
  // via KeepAlive — spawning a second process would cause a race.
  if (!launchAgentInstalled) {
    logger.debug('no LaunchAgent installed, spawning daemon directly...');
    const daemonProcess = spawnFreeCLI(['daemon', 'start-sync'], {
      detached: true,
      stdio: 'ignore',
      env: process.env,
    });
    daemonProcess.unref();
  }

  // Wait for daemon to start (up to 10s — daemon needs time for auth + IPC init)
  logger.debug('waiting for daemon to become ready (up to 10s)...');
  for (let i = 0; i < 100; i++) {
    if (await isDaemonRunningCurrentlyInstalledFreeVersion()) {
      logger.debug('daemon ready', { waitMs: i * 100 });
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  // If service file exists but daemon didn't start, the service may be unloaded
  // (e.g. after `free daemon stop` or system restart). Try reloading it, then
  // fall back to a direct spawn if it still doesn't come up.
  if (launchAgentInstalled) {
    logger.debug('service file exists but daemon not running, attempting service reload...');
    const result = await startDaemonService();
    logger.debug('service reload result', { success: result.success, message: result.message });

    // Give the service manager a few seconds to start the daemon
    for (let i = 0; i < 50; i++) {
      if (await isDaemonRunningCurrentlyInstalledFreeVersion()) {
        logger.debug('daemon ready after service reload', { waitMs: i * 100 });
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Service reload failed — fall back to direct spawn as last resort
    logger.warn('service reload did not start daemon, falling back to direct spawn...');
    const daemonProcess = spawnFreeCLI(['daemon', 'start-sync'], {
      detached: true,
      stdio: 'ignore',
      env: process.env,
    });
    daemonProcess.unref();

    // Final wait
    for (let i = 0; i < 50; i++) {
      if (await isDaemonRunningCurrentlyInstalledFreeVersion()) {
        logger.debug('daemon ready after fallback spawn', { waitMs: i * 100 });
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  logger.warn('daemon did not become ready within timeout, proceeding anyway');
}

/**
 * Query the daemon for truly orphaned sessions (active but no CLI clients attached)
 * and return the most recent one's ID, or undefined if none exist.
 *
 * Only sessions with attachedClients === 0 are considered orphans.
 * Sessions that already have a CLI attached (e.g. another terminal) are NOT
 * candidates — attaching to them would steal another terminal's session
 * and make concurrent sessions impossible.
 */
async function discoverOrphanSession(): Promise<string | undefined> {
  let ipc: IPCClient | undefined;
  try {
    ipc = new IPCClient();
    await ipc.connect(configuration.daemonSocketPath);
    const sessions = await new Promise<Array<{ sessionId: string; state: string; startedAt: string; attachedClients?: number }>>((resolve, reject) => {
      const timeout = setTimeout(() => {
        ipc!.off('session_list', handler);
        reject(new Error('list_sessions timeout'));
      }, 5_000);
      const handler = (msg: IPCServerMessage) => {
        if (msg.type !== 'session_list') return;
        clearTimeout(timeout);
        ipc!.off('session_list', handler);
        resolve(msg.sessions as Array<{ sessionId: string; state: string; startedAt: string; attachedClients?: number }>);
      };
      ipc!.on('session_list', handler);
      ipc!.send({ type: 'list_sessions' });
    });

    // Only consider sessions that are active AND have zero attached CLI clients.
    // This prevents hijacking sessions already being used in another terminal.
    const orphanSessions = sessions.filter(
      s => s.state !== 'archived' && (s.attachedClients ?? 0) === 0
    );
    if (orphanSessions.length > 0) {
      orphanSessions.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
      const target = orphanSessions[0];
      console.log(chalk.yellow(`Found ${orphanSessions.length} orphan session(s). Re-attaching to ${target.sessionId}...`));
      return target.sessionId;
    }
    return undefined;
  } catch {
    logger.debug('orphan session discovery failed, proceeding with new session');
    return undefined;
  } finally {
    ipc?.disconnect();
  }
}

(async () => {
  const args = process.argv.slice(2);

  // If --version is passed - do not log, its likely daemon inquiring about our version
  if (!args.includes('--version')) {
    logger.info('Starting free CLI with args: ', process.argv);
  }

  // Check if first argument is a subcommand
  const subcommand = args[0];

  // Log which subcommand was detected (for debugging)
  if (!args.includes('--version')) {
  }

  if (subcommand === 'doctor') {
    // Check for clean subcommand
    if (args[1] === 'clean') {
      const result = await killRunawayFreeProcesses();
      console.log(`Cleaned up ${result.killed} runaway processes`);
      if (result.errors.length > 0) {
        console.log('Errors:', result.errors);
      }
      process.exit(0);
    }
    await runDoctorCommand();
    return;
  } else if (subcommand === 'auth') {
    // Handle auth subcommands
    try {
      await handleAuthCommand(args.slice(1));
    } catch (error) {
      console.error(chalk.red('Error:'), safeStringify(error));
      logger.info('Command failed', { error: safeStringify(error) });
      process.exit(1);
    }
    return;
  } else if (subcommand === 'connect') {
    // Handle connect subcommands
    try {
      await handleConnectCommand(args.slice(1));
    } catch (error) {
      console.error(chalk.red('Error:'), safeStringify(error));
      logger.info('Command failed', { error: safeStringify(error) });
      process.exit(1);
    }
    return;
  } else if (subcommand === 'sandbox') {
    try {
      await handleSandboxCommand(args.slice(1));
    } catch (error) {
      console.error(chalk.red('Error:'), safeStringify(error));
      logger.info('Command failed', { error: safeStringify(error) });
      process.exit(1);
    }
    return;
  } else if (subcommand === 'analytics') {
    try {
      await handleAnalyticsCommand(args.slice(1));
    } catch (error) {
      console.error(chalk.red('Error:'), safeStringify(error));
      logger.info('Command failed', { error: safeStringify(error) });
      process.exit(1);
    }
    return;
  } else if (subcommand === 'codex') {
    // Handle codex command
    try {
      const codexArgs = extractNoSandboxFlag(args.slice(1));
      let resumeSessionId: string | undefined;
      for (let i = 0; i < codexArgs.args.length; i++) {
        if (codexArgs.args[i] === '--resume-session-id' && i + 1 < codexArgs.args.length) {
          resumeSessionId = codexArgs.args[++i];
        }
      }

      await authAndSetupMachineIfNeeded();

      await ensureDaemonRunning();

      const settings = await readSettings();
      const sandboxEnabled = Boolean(settings.sandboxConfig?.enabled && !codexArgs.noSandbox);
      const permissionMode = applySandboxPermissionPolicy(
        resolveInitialClaudePermissionMode(undefined, []),
        sandboxEnabled
      );

      const codexAttachSessionId = resumeSessionId
        ? undefined
        : await discoverOrphanSession();

      await runWithDaemonIPC({
        spawnOpts: {
          agent: 'codex',
          directory: process.cwd(),
          resumeAgentSessionId: resumeSessionId,
          permissionMode,
          startedBy: 'cli',
        },
        attachSessionId: codexAttachSessionId,
      });
    } catch (error) {
      console.error(chalk.red('Error:'), safeStringify(error));
      logger.info('Command failed', { error: safeStringify(error) });
      process.exit(1);
    }
    return;
  } else if (subcommand === 'gemini') {
    // Handle gemini subcommands
    const geminiSubcommand = args[1];

    // Handle "free gemini model set <model>" command
    if (geminiSubcommand === 'model' && args[2] === 'set' && args[3]) {
      const modelName = args[3];
      const validModels = ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'];

      if (!validModels.includes(modelName)) {
        console.error(`Invalid model: ${modelName}`);
        console.error(`Available models: ${validModels.join(', ')}`);
        process.exit(1);
      }

      try {
        const { existsSync, readFileSync, writeFileSync, mkdirSync } = require('fs');
        const { join } = require('path');
        const { homedir } = require('os');

        const configDir = join(homedir(), '.gemini');
        const configPath = join(configDir, 'config.json');

        // Create directory if it doesn't exist
        if (!existsSync(configDir)) {
          mkdirSync(configDir, { recursive: true });
        }

        // Read existing config or create new one
        let config: any = {};
        if (existsSync(configPath)) {
          try {
            config = JSON.parse(readFileSync(configPath, 'utf-8'));
          } catch (error) {
            // Ignore parse errors, start fresh
            config = {};
          }
        }

        // Update model in config
        config.model = modelName;

        // Write config back
        writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
        console.log(`✓ Model set to: ${modelName}`);
        console.log(`  Config saved to: ${configPath}`);
        console.log(`  This model will be used in future sessions.`);
        process.exit(0);
      } catch (error) {
        console.error('Failed to save model configuration:', error);
        process.exit(1);
      }
    }

    // Handle "free gemini model get" command
    if (geminiSubcommand === 'model' && args[2] === 'get') {
      try {
        const { existsSync, readFileSync } = require('fs');
        const { join } = require('path');
        const { homedir } = require('os');

        const configPaths = [
          join(homedir(), '.gemini', 'config.json'),
          join(homedir(), '.config', 'gemini', 'config.json'),
        ];

        let model: string | null = null;
        for (const configPath of configPaths) {
          if (existsSync(configPath)) {
            try {
              const config = JSON.parse(readFileSync(configPath, 'utf-8'));
              model = config.model || config.GEMINI_MODEL || null;
              if (model) break;
            } catch (error) {
              // Ignore parse errors
            }
          }
        }

        if (model) {
          console.log(`Current model: ${model}`);
        } else if (process.env.GEMINI_MODEL) {
          console.log(`Current model: ${process.env.GEMINI_MODEL} (from GEMINI_MODEL env var)`);
        } else {
          console.log('Current model: gemini-2.5-pro (default)');
        }
        process.exit(0);
      } catch (error) {
        console.error('Failed to read model configuration:', error);
        process.exit(1);
      }
    }

    // Handle "free gemini project set <project-id>" command
    if (geminiSubcommand === 'project' && args[2] === 'set' && args[3]) {
      const projectId = args[3];

      try {
        const { saveGoogleCloudProjectToConfig } = await import('@/gemini/utils/config');
        const { readCredentials } = await import('@/persistence');
        const { ApiClient } = await import('@/api/api');

        // Try to get current user email from Free cloud token
        let userEmail: string | undefined = undefined;
        try {
          const credentials = await readCredentials();
          if (credentials) {
            const api = await ApiClient.create(credentials);
            const vendorToken = await api.getVendorToken('gemini');
            if (vendorToken?.oauth?.id_token) {
              const parts = vendorToken.oauth.id_token.split('.');
              if (parts.length === 3) {
                const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
                userEmail = payload.email;
              }
            }
          }
        } catch {
          // If we can't get email, project will be saved globally
        }

        saveGoogleCloudProjectToConfig(projectId, userEmail);
        console.log(`✓ Google Cloud Project set to: ${projectId}`);
        if (userEmail) {
          console.log(`  Linked to account: ${userEmail}`);
        }
        console.log(`  This project will be used for Google Workspace accounts.`);
        process.exit(0);
      } catch (error) {
        console.error('Failed to save project configuration:', error);
        process.exit(1);
      }
    }

    // Handle "free gemini project get" command
    if (geminiSubcommand === 'project' && args[2] === 'get') {
      try {
        const { readGeminiLocalConfig } = await import('@/gemini/utils/config');
        const config = readGeminiLocalConfig();

        if (config.googleCloudProject) {
          console.log(`Current Google Cloud Project: ${config.googleCloudProject}`);
          if (config.googleCloudProjectEmail) {
            console.log(`  Linked to account: ${config.googleCloudProjectEmail}`);
          } else {
            console.log(`  Applies to: all accounts (global)`);
          }
        } else if (process.env.GOOGLE_CLOUD_PROJECT) {
          console.log(
            `Current Google Cloud Project: ${process.env.GOOGLE_CLOUD_PROJECT} (from env var)`
          );
        } else {
          console.log('No Google Cloud Project configured.');
          console.log('');
          console.log('If you see "Authentication required" error, you may need to set a project:');
          console.log('  free gemini project set <your-project-id>');
          console.log('');
          console.log('This is required for Google Workspace accounts.');
          console.log('Guide: https://goo.gle/gemini-cli-auth-docs#workspace-gca');
        }
        process.exit(0);
      } catch (error) {
        console.error('Failed to read project configuration:', error);
        process.exit(1);
      }
    }

    // Handle "free gemini project" (no subcommand) - show help
    if (geminiSubcommand === 'project' && !args[2]) {
      console.log('Usage: free gemini project <command>');
      console.log('');
      console.log('Commands:');
      console.log('  set <project-id>   Set Google Cloud Project ID');
      console.log('  get                Show current Google Cloud Project ID');
      console.log('');
      console.log('Google Workspace accounts require a Google Cloud Project.');
      console.log('If you see "Authentication required" error, set your project ID.');
      console.log('');
      console.log('Guide: https://goo.gle/gemini-cli-auth-docs#workspace-gca');
      process.exit(0);
    }

    // Handle gemini command (daemon-owned ACP backend)
    try {
      let resumeSessionId: string | undefined;
      for (let i = 1; i < args.length; i++) {
        if (args[i] === '--resume-session-id' && i + 1 < args.length) {
          resumeSessionId = args[++i];
        }
      }

      await authAndSetupMachineIfNeeded();

      await ensureDaemonRunning();

      const geminiAttachSessionId = resumeSessionId
        ? undefined
        : await discoverOrphanSession();

      await runWithDaemonIPC({
        spawnOpts: {
          agent: 'gemini',
          directory: process.cwd(),
          resumeAgentSessionId: resumeSessionId,
          startedBy: 'cli',
        },
        attachSessionId: geminiAttachSessionId,
      });
    } catch (error) {
      console.error(chalk.red('Error:'), safeStringify(error));
      logger.info('Command failed', { error: safeStringify(error) });
      process.exit(1);
    }
    return;
  } else if (subcommand === 'opencode') {
    // Handle opencode command
    try {
      let resumeSessionId: string | undefined;
      const opencodeArgs = args.slice(1);
      for (let i = 0; i < opencodeArgs.length; i++) {
        if (opencodeArgs[i] === '--resume-session-id' && i + 1 < opencodeArgs.length) {
          resumeSessionId = opencodeArgs[++i];
        }
      }

      await authAndSetupMachineIfNeeded();

      await ensureDaemonRunning();

      const opencodeAttachSessionId = resumeSessionId
        ? undefined
        : await discoverOrphanSession();

      await runWithDaemonIPC({
        spawnOpts: {
          agent: 'opencode',
          directory: process.cwd(),
          resumeAgentSessionId: resumeSessionId,
          startedBy: 'cli',
        },
        attachSessionId: opencodeAttachSessionId,
      });
    } catch (error) {
      console.error(chalk.red('Error:'), safeStringify(error));
      logger.info('Command failed', { error: safeStringify(error) });
      process.exit(1);
    }
    return;
  } else if (subcommand === 'logout') {
    // Keep for backward compatibility - redirect to auth logout
    console.log(
      chalk.yellow('Note: "free logout" is deprecated. Use "free auth logout" instead.\n')
    );
    try {
      await handleAuthCommand(['logout']);
    } catch (error) {
      console.error(chalk.red('Error:'), safeStringify(error));
      logger.info('Command failed', { error: safeStringify(error) });
      process.exit(1);
    }
    return;
  } else if (subcommand === 'notify') {
    // Handle notification command
    try {
      await handleNotifyCommand(args.slice(1));
    } catch (error) {
      console.error(chalk.red('Error:'), safeStringify(error));
      logger.info('Command failed', { error: safeStringify(error) });
      process.exit(1);
    }
    return;
  } else if (subcommand === 'daemon') {
    // Show daemon management help
    const daemonSubcommand = args[1];

    if (daemonSubcommand === 'list') {
      try {
        const sessions = await listDaemonSessions();

        if (sessions.length === 0) {
          console.log(
            'No active sessions this daemon is aware of (they might have been started by a previous version of the daemon)'
          );
        } else {
          console.log('Active sessions:');
          console.log(JSON.stringify(sessions, null, 2));
        }
      } catch (error) {
        console.log('No daemon running');
      }
      return;
    } else if (daemonSubcommand === 'stop-session') {
      const sessionId = args[2];
      if (!sessionId) {
        console.error('Session ID required');
        process.exit(1);
      }

      try {
        const success = await stopDaemonSession(sessionId);
        console.log(success ? 'Session stopped' : 'Failed to stop session');
      } catch (error) {
        console.log('No daemon running');
      }
      return;
    } else if (daemonSubcommand === 'start') {
      // Re-install to sync environment variables (FREE_HOME_DIR, APP_ENV, PATH)
      // installUserAgent() handles unload → write plist → load
      try {
        await install();
        const variantLabel = configuration.variant === 'dev' ? ' (dev)' : '';
        console.log(chalk.green('✓ ') + `Daemon${variantLabel} started via system service`);
      } catch (error) {
        console.log(chalk.red('✗ ') + safeStringify(error));
        process.exit(1);
      }
      process.exit(0);
    } else if (daemonSubcommand === 'start-sync') {
      // Internal command - runs daemon directly (used by LaunchAgent/systemd)
      await startDaemon();
      process.exit(0);
    } else if (daemonSubcommand === 'stop') {
      const result = await stopDaemonService();
      if (result.success) {
        console.log(chalk.green('✓ ') + result.message);
      } else {
        console.log(chalk.red('✗ ') + result.message);
        process.exit(1);
      }
      process.exit(0);
    } else if (daemonSubcommand === 'status') {
      // Show daemon-specific doctor output
      await runDoctorCommand('daemon');
      process.exit(0);
    } else if (daemonSubcommand === 'logs') {
      // Simply print the path to the latest daemon log file
      const latest = await getLatestDaemonLog();
      if (!latest) {
        console.log('No daemon logs found');
      } else {
        console.log(latest.path);
      }
      process.exit(0);
    } else if (daemonSubcommand === 'install') {
      try {
        await install();
      } catch (error) {
        console.error(
          chalk.red('Error:'),
          safeStringify(error)
        );
        process.exit(1);
      }
    } else if (daemonSubcommand === 'uninstall') {
      try {
        await uninstall();
      } catch (error) {
        console.error(
          chalk.red('Error:'),
          safeStringify(error)
        );
        process.exit(1);
      }
    } else {
      console.log(`
${chalk.bold('free daemon')} - Daemon management

${chalk.bold('Usage:')}
  free daemon start              Start the daemon (detached)
  free daemon stop               Stop the daemon (sessions stay alive)
  free daemon status             Show daemon status
  free daemon list               List active sessions
  free daemon logs               Show path to latest daemon log

${chalk.bold('Auto-start (system service):')}
  free daemon install            Install as user service (auto-start + auto-restart)
  free daemon uninstall          Remove user service

  ${chalk.gray('macOS: Uses LaunchAgent (no sudo required)')}
  ${chalk.gray('Linux: Uses systemd user service')}

${chalk.bold('Cleanup:')}
  If you want to kill all free related processes run
  ${chalk.cyan('free doctor clean')}

${chalk.bold('Note:')} The daemon runs in the background and manages sessions.

${chalk.bold('To clean up runaway processes:')} Use ${chalk.cyan('free doctor clean')}
`);
    }
    return;
  } else if (subcommand === 'diagnostic') {
    // free diagnostic export [--session <id>] [--trace <id>] [--since <duration>]
    const diagSubcommand = args[1];
    if (diagSubcommand === 'export') {
      const diagArgs = args.slice(2);
      let sessionId: string | undefined;
      let traceId: string | undefined;
      let since: string | undefined;
      for (let i = 0; i < diagArgs.length; i++) {
        if (diagArgs[i] === '--session' && diagArgs[i + 1]) sessionId = diagArgs[++i];
        else if (diagArgs[i] === '--trace' && diagArgs[i + 1]) traceId = diagArgs[++i];
        else if (diagArgs[i] === '--since' && diagArgs[i + 1]) since = diagArgs[++i];
      }
      // Parse --since as relative duration (e.g. "1h", "24h", "7d")
      let sinceIso: string | undefined;
      if (since) {
        const match = since.match(/^(\d+)([smhd])$/);
        if (match) {
          const [, n, unit] = match;
          const ms = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit as 's'|'m'|'h'|'d']!;
          sinceIso = new Date(Date.now() - Number(n) * ms).toISOString();
        }
      }
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const outputPath = `${process.cwd()}/diagnostic-${ts}.zip`;
      try {
        const result = exportDiagnostic({
          logDirs: [configuration.logsDir],
          outputPath,
          traceId,
          sessionId,
          since: sinceIso,
          environment: {
            platform: process.platform,
            nodeVersion: process.version,
            cliVersion: packageJson.version,
            logsDir: configuration.logsDir,
          },
        });
        console.log(chalk.green(`✓ Created ${result.outputPath} (${result.entriesCount} entries)`));
      } catch (err) {
        console.error(chalk.red('Error:'), safeStringify(err));
        process.exit(1);
      }
    } else {
      console.log(`
${chalk.bold('free diagnostic')} - Diagnostic log export

${chalk.bold('Usage:')}
  free diagnostic export                  Export all local logs
  free diagnostic export --session <id>   Export logs for a session
  free diagnostic export --trace <id>     Export logs for a trace ID
  free diagnostic export --since <dur>    Export logs since duration (e.g. 1h, 24h, 7d)

${chalk.bold('Output:')} diagnostic-<timestamp>.zip (logs.jsonl + environment.json)
`);
    }
    return;
  } else if (subcommand === 'logs') {
    // free logs [search] [--trace <id>] [--session <id>] [--level <lvl>] [--since <dur>]
    const logsArgs = args.slice(1);
    let traceId: string | undefined;
    let sessionId: string | undefined;
    let level: string | undefined;
    let since: string | undefined;
    let showHelp = false;
    for (let i = 0; i < logsArgs.length; i++) {
      if (logsArgs[i] === '--trace' && logsArgs[i + 1]) traceId = logsArgs[++i];
      else if (logsArgs[i] === '--session' && logsArgs[i + 1]) sessionId = logsArgs[++i];
      else if (logsArgs[i] === '--level' && logsArgs[i + 1]) level = logsArgs[++i];
      else if (logsArgs[i] === '--since' && logsArgs[i + 1]) since = logsArgs[++i];
      else if (logsArgs[i] === '--help' || logsArgs[i] === '-h') showHelp = true;
    }
    if (showHelp || logsArgs.length === 0) {
      console.log(`
${chalk.bold('free logs')} - Search local log files

${chalk.bold('Usage:')}
  free logs search [options]

${chalk.bold('Options:')}
  --trace <id>      Filter by trace ID
  --session <id>    Filter by session ID
  --level <lvl>     Filter by level (debug|info|warn|error)
  --since <dur>     Only show logs since duration (e.g. 1h, 24h, 7d)

${chalk.bold('Log directory:')} ${configuration.logsDir}
`);
      return;
    }
    // Parse --since
    let sinceIso: string | undefined;
    if (since) {
      const match = since.match(/^(\d+)([smhd])$/);
      if (match) {
        const [, n, unit] = match;
        const ms = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit as 's'|'m'|'h'|'d']!;
        sinceIso = new Date(Date.now() - Number(n) * ms).toISOString();
      }
    }
    // Read and filter JSONL files
    const { readdirSync, readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const logsDir = configuration.logsDir;
    let count = 0;
    try {
      const files = readdirSync(logsDir)
        .filter((f: string) => f.endsWith('.jsonl'))
        .sort()
        .map((f: string) => join(logsDir, f));

      for (const file of files) {
        const lines = readFileSync(file, 'utf-8').split('\n');
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const entry = JSON.parse(line) as Record<string, unknown>;
            if (traceId && entry.traceId !== traceId) continue;
            if (sessionId && entry.sessionId !== sessionId) continue;
            if (level && entry.level !== level) continue;
            if (sinceIso && typeof entry.timestamp === 'string' && entry.timestamp < sinceIso) continue;
            console.log(line);
            count++;
          } catch { /* skip malformed lines */ }
        }
      }
      if (count === 0) console.log(chalk.gray('No matching log entries found.'));
      else console.error(chalk.gray(`\n${count} entries`));
    } catch (err) {
      console.error(chalk.red('Error reading logs:'), safeStringify(err));
      process.exit(1);
    }
    return;
  } else {
    // If the first argument is claude, remove it
    if (args.length > 0 && args[0] === 'claude') {
      args.shift();
    }

    // Parse command line arguments for main command
    const options: StartOptions = {};
    let showHelp = false;
    let showVersion = false;
    let chromeOverride: boolean | undefined = undefined; // Track explicit --chrome or --no-chrome
    const unknownArgs: string[] = []; // Collect unknown args to pass through to claude
    const parsedSandboxFlag = extractNoSandboxFlag(args);
    options.noSandbox = parsedSandboxFlag.noSandbox;
    args.length = 0;
    args.push(...parsedSandboxFlag.args);

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];

      if (arg === '-h' || arg === '--help') {
        showHelp = true;
        // Also pass through to claude
        unknownArgs.push(arg);
      } else if (arg === '-v' || arg === '--version') {
        showVersion = true;
      } else if (arg === '--free-starting-mode') {
        options.startingMode = z.enum(['local', 'remote']).parse(args[++i]);
      } else if (arg === '--yolo') {
        // Shortcut for --dangerously-skip-permissions
        unknownArgs.push('--dangerously-skip-permissions');
      } else if (arg === '--started-by') {
        options.startedBy = args[++i] as 'cli' | 'daemon' | 'app';
      } else if (arg === '--resume-session-id') {
        options.resumeSessionId = args[++i];
      } else if (arg === '--attach-session') {
        options.attachSessionId = args[++i];
      } else if (arg === '--js-runtime') {
        const runtime = args[++i];
        if (runtime !== 'node' && runtime !== 'bun') {
          console.error(
            chalk.red(`Invalid --js-runtime value: ${runtime}. Must be 'node' or 'bun'`)
          );
          process.exit(1);
        }
        options.jsRuntime = runtime;
      } else if (arg === '--claude-env') {
        // Parse KEY=VALUE environment variable to pass to Claude
        const envArg = args[++i];
        if (envArg && envArg.includes('=')) {
          const eqIndex = envArg.indexOf('=');
          const key = envArg.substring(0, eqIndex);
          const value = envArg.substring(eqIndex + 1);
          options.claudeEnvVars = options.claudeEnvVars || {};
          options.claudeEnvVars[key] = value;
        } else {
          console.error(chalk.red(`Invalid --claude-env format: ${envArg}. Expected KEY=VALUE`));
          process.exit(1);
        }
      } else if (arg === '--chrome') {
        chromeOverride = true;
        // We'll add --chrome to claudeArgs after resolving settings default
      } else if (arg === '--no-chrome') {
        chromeOverride = false;
        // Free-specific flag to disable chrome even if default is on
      } else if (arg === '--settings') {
        // Intercept --settings flag - Free uses this internally for session hooks
        const settingsValue = args[++i]; // consume the value
        console.warn(
          chalk.yellow(`⚠️  Warning: --settings is used internally by Free for session tracking.`)
        );
        console.warn(chalk.yellow(`   Your settings file "${settingsValue}" will be ignored.`));
        console.warn(chalk.yellow(`   To configure Claude, edit ~/.claude/settings.json instead.`));
        // Don't pass through to claudeArgs
      } else {
        // Pass unknown arguments through to claude
        unknownArgs.push(arg);
        // Check if this arg expects a value (simplified check for common patterns)
        if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
          unknownArgs.push(args[++i]);
        }
      }
    }

    // Add unknown args to claudeArgs
    if (unknownArgs.length > 0) {
      options.claudeArgs = [...(options.claudeArgs || []), ...unknownArgs];
    }

    // Resolve Chrome mode: explicit flag > settings > false
    const settings = await readSettings();
    const chromeEnabled = chromeOverride ?? settings.chromeMode ?? false;
    if (chromeEnabled) {
      options.claudeArgs = [...(options.claudeArgs || []), '--chrome'];
    }

    // Show help
    if (showHelp) {
      console.log(`
${chalk.bold('free')} - Claude Code On the Go

${chalk.bold('Usage:')}
  free [options]         Start Claude with mobile control
  free auth              Manage authentication
  free codex             Start Codex mode
  free gemini            Start Gemini mode (ACP)
  free connect           Connect AI vendor API keys
  free sandbox           Configure and manage OS-level sandboxing
  free analytics         Manage analytics/telemetry settings
  free notify            Send push notification
  free daemon            Manage background service that allows
                            to spawn new sessions away from your computer
  free doctor            System diagnostics & troubleshooting
  free diagnostic        Export diagnostic log bundle
  free logs              Search local log files

${chalk.bold('Examples:')}
  free                    Start session
  free --yolo             Start with bypassing permissions
                            free sugar for --dangerously-skip-permissions
  free --chrome           Enable Chrome browser access for this session
  free --no-chrome        Disable Chrome even if default is on
  free --no-sandbox       Disable Free sandbox for this session
  free --js-runtime bun   Use bun instead of node to spawn Claude Code
  free --claude-env ANTHROPIC_BASE_URL=http://127.0.0.1:3456
                           Use a custom API endpoint (e.g., claude-code-router)
  free auth login --force Authenticate
  free doctor             Run diagnostics

${chalk.bold('Free supports ALL Claude options!')}
  Use any claude flag with free as you would with claude. Our favorite:

  free --resume

${chalk.gray('─'.repeat(60))}
${chalk.bold.cyan('Claude Code Options (from `claude --help`):')}
`);

      // Run claude --help and display its output
      // claudeCliPath is a .cjs script, so we must run it via node
      try {
        const claudeHelp = execFileSync(process.execPath, [claudeCliPath, '--help'], { encoding: 'utf8' });
        console.log(claudeHelp);
      } catch (e) {
        console.log(chalk.yellow('Could not retrieve claude help. Make sure claude is installed.'));
      }

      process.exit(0);
    }

    // Show version
    if (showVersion) {
      const { readBuildMeta } = await import('./utils/buildMeta');
      const meta = readBuildMeta();
      const parts = [`free version: ${packageJson.version}`];
      if (meta.hash) parts.push(`build: ${meta.hash.substring(0, 8)}`);
      if (meta.time) parts.push(`(${new Date(meta.time).toLocaleString()})`);
      console.log(parts.join('  '));
      process.exit(0);
    }

    // --attach-session mode: skip auth/daemon startup, daemon must already be running.
    if (options.attachSessionId) {
      logger.debug('attach-session mode', { attachSessionId: options.attachSessionId });
      try {
        await runWithDaemonIPC({
          spawnOpts: {
            agent: 'claude',
            directory: process.cwd(),
            startedBy: 'cli',
          },
          attachSessionId: options.attachSessionId,
        });
      } catch (error) {
        console.error(chalk.red('Error:'), safeStringify(error));
        logger.info('Command failed', { error: safeStringify(error) });
        process.exit(1);
      }
      process.exit(0);
    }

    // Normal flow - auth and machine setup
    logger.debug('step 1/4: authenticating...');
    const { credentials } = await authAndSetupMachineIfNeeded();
    logger.debug('step 1/4: auth OK');

    logger.debug('step 2/4: ensuring daemon is running...');
    await ensureDaemonRunning();
    logger.debug('step 2/4: daemon OK');

    // Resolve permission mode from CLI args
    const sandboxEnabled = Boolean(settings.sandboxConfig?.enabled && !options.noSandbox);
    const permissionMode = applySandboxPermissionPolicy(
      resolveInitialClaudePermissionMode(options.permissionMode, options.claudeArgs),
      sandboxEnabled
    );

    // Discover orphan sessions: if active sessions exist, auto-attach to the most recent one.
    // Skip when user explicitly wants to resume a specific Claude session (--resume-session-id).
    const attachSessionId = options.resumeSessionId
      ? undefined
      : await discoverOrphanSession();

    // Start the CLI via daemon IPC
    logger.debug('step 3/4: connecting to daemon IPC...');
    try {
      await runWithDaemonIPC({
        spawnOpts: {
          agent: 'claude',
          directory: process.cwd(),
          resumeAgentSessionId: options.resumeSessionId,
          permissionMode,
          model: options.model,
          sessionTag: process.env.FREE_SESSION_TAG,
          startedBy: 'cli',
        },
        attachSessionId,
      });
    } catch (error) {
      console.error(chalk.red('Error:'), safeStringify(error));
      logger.info('Command failed', { error: safeStringify(error) });
      process.exit(1);
    }
  }
})();

/**
 * Handle notification command
 */
async function handleNotifyCommand(args: string[]): Promise<void> {
  let message = '';
  let title = '';
  let showHelp = false;

  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '-p' && i + 1 < args.length) {
      message = args[++i];
    } else if (arg === '-t' && i + 1 < args.length) {
      title = args[++i];
    } else if (arg === '-h' || arg === '--help') {
      showHelp = true;
    } else {
      console.error(chalk.red(`Unknown argument for notify command: ${arg}`));
      process.exit(1);
    }
  }

  if (showHelp) {
    console.log(`
${chalk.bold('free notify')} - Send notification

${chalk.bold('Usage:')}
  free notify -p <message> [-t <title>]    Send notification with custom message and optional title
  free notify -h, --help                   Show this help

${chalk.bold('Options:')}
  -p <message>    Notification message (required)
  -t <title>      Notification title (optional, defaults to "Free")

${chalk.bold('Examples:')}
  free notify -p "Deployment complete!"
  free notify -p "System update complete" -t "Server Status"
  free notify -t "Alert" -p "Database connection restored"
`);
    return;
  }

  if (!message) {
    console.error(
      chalk.red(
        'Error: Message is required. Use -p "your message" to specify the notification text.'
      )
    );
    console.log(chalk.gray('Run "free notify --help" for usage information.'));
    process.exit(1);
  }

  // Load credentials
  const credentials = await readCredentials();
  if (!credentials) {
    console.error(chalk.red('Error: Not authenticated. Please run "free auth login" first.'));
    process.exit(1);
  }

  console.log(chalk.blue('📱 Sending push notification...'));

  try {
    // Create API client and send push notification
    const api = await ApiClient.create(credentials);

    // Use custom title or default to "Free"
    const notificationTitle = title || 'Free';

    // Send the push notification
    api.push().sendToAllDevices(notificationTitle, message, {
      source: 'cli',
      timestamp: Date.now(),
    });

    console.log(chalk.green('✓ Push notification sent successfully!'));
    console.log(chalk.gray(`  Title: ${notificationTitle}`));
    console.log(chalk.gray(`  Message: ${message}`));
    console.log(chalk.gray('  Check your mobile device for the notification.'));

    // Give a moment for the async operation to start
    await new Promise(resolve => setTimeout(resolve, 1000));
  } catch (error) {
    console.error(chalk.red('✗ Failed to send push notification'));
    throw error;
  }
}
