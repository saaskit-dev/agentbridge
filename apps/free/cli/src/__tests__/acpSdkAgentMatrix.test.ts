import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import {
  afterEach,
  describe,
  expect,
  it,
  onTestFailed,
} from 'vitest';
import {
  ClientSideConnection,
  PROTOCOL_VERSION,
  RequestError,
  ndJsonStream,
  type ContentBlock,
  type CurrentModeUpdate,
  type NewSessionResponse,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionConfigOption,
  type SessionConfigSelectGroup,
  type SessionConfigSelectOption,
  type SessionNotification,
  type SessionUpdate,
} from '@agentclientprotocol/sdk';

const runRealSdkMatrix = process.env.FREE_RUN_ACP_SDK_MATRIX === '1';

type AgentSpec = {
  id: 'claude' | 'codex' | 'gemini' | 'opencode';
  command: string;
  args: string[];
  env?: Record<string, string>;
  timeoutMs: number;
};

type RunningAgent = {
  child: ChildProcessWithoutNullStreams;
  connection: ClientSideConnection;
  sessionUpdates: SessionUpdate[];
  stderrLines: string[];
  permissionRequests: RequestPermissionRequest[];
  cwd: string;
  cleanup: () => Promise<void>;
};

type FlattenedSelectValue = {
  value: string;
  label: string;
};

function getCodexAcpPlatformPackage(): string | null {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === 'darwin' && arch === 'arm64') {
    return '@zed-industries/codex-acp-darwin-arm64';
  }
  if (platform === 'darwin' && arch === 'x64') {
    return '@zed-industries/codex-acp-darwin-x64';
  }
  if (platform === 'linux' && arch === 'arm64') {
    return '@zed-industries/codex-acp-linux-arm64';
  }
  if (platform === 'linux' && arch === 'x64') {
    return '@zed-industries/codex-acp-linux-x64';
  }
  if (platform === 'win32' && arch === 'arm64') {
    return '@zed-industries/codex-acp-win32-arm64';
  }
  if (platform === 'win32' && arch === 'x64') {
    return '@zed-industries/codex-acp-win32-x64';
  }

  return null;
}

function getCodexAcpCommandArgs(): string[] {
  const version = '0.9.5';
  const launcherPackage = `@zed-industries/codex-acp@${version}`;
  const platformPackage = getCodexAcpPlatformPackage();

  if (!platformPackage) {
    return ['-y', launcherPackage, 'codex-acp'];
  }

  return ['-y', '-p', launcherPackage, '-p', `${platformPackage}@${version}`, 'codex-acp'];
}

const agentMatrix: AgentSpec[] = [
  {
    id: 'claude',
    command: 'npx',
    args: ['-y', '@zed-industries/claude-agent-acp'],
    timeoutMs: 180_000,
  },
  {
    id: 'codex',
    command: 'npx',
    args: getCodexAcpCommandArgs(),
    timeoutMs: 180_000,
  },
  {
    id: 'gemini',
    command: 'gemini',
    args: ['--experimental-acp'],
    env: {
      GEMINI_MODEL: process.env.GEMINI_MODEL || 'gemini-2.5-pro',
      NODE_ENV: 'production',
      DEBUG: '',
    },
    timeoutMs: 120_000,
  },
  {
    id: 'opencode',
    command: 'opencode',
    args: ['acp'],
    timeoutMs: 120_000,
  },
];

function hasCommand(command: string): boolean {
  const result = spawnSync('sh', ['-lc', `command -v ${command}`], {
    stdio: 'ignore',
  });
  return result.status === 0;
}

function getSkipReason(spec: AgentSpec): string | null {
  if (!runRealSdkMatrix) {
    return 'FREE_RUN_ACP_SDK_MATRIX=1 not set';
  }

  if (spec.command !== 'npx' && !hasCommand(spec.command)) {
    return `command '${spec.command}' not found`;
  }

  if (spec.id === 'codex' && !process.env.OPENAI_API_KEY) {
    return 'OPENAI_API_KEY not set';
  }

  if (
    spec.id === 'gemini' &&
    !process.env.GEMINI_API_KEY &&
    !process.env.GOOGLE_API_KEY
  ) {
    return 'GEMINI_API_KEY or GOOGLE_API_KEY not set';
  }

  return null;
}

function flattenSelectOptions(
  options: Array<SessionConfigSelectOption | SessionConfigSelectGroup>
): FlattenedSelectValue[] {
  return options.flatMap(entry =>
    'group' in entry
      ? entry.options.map(option => ({
          value: option.value,
          label: `${entry.name} / ${option.name}`,
        }))
      : [{ value: entry.value, label: entry.name }]
  );
}

function pickAlternateMode(session: NewSessionResponse): string | null {
  const modes = session.modes?.availableModes ?? [];
  const current = session.modes?.currentModeId ?? null;
  const next = modes.find(mode => mode.id !== current);
  return next?.id ?? null;
}

function pickAlternateModel(session: NewSessionResponse): string | null {
  const models = session.models?.availableModels ?? [];
  const current = session.models?.currentModelId ?? null;
  const next = models.find(model => model.modelId !== current);
  return next?.modelId ?? null;
}

function pickAlternateConfigOption(session: NewSessionResponse): {
  configId: string;
  value: string;
} | null {
  const option = (session.configOptions ?? []).find(
    candidate => candidate.type === 'select' && candidate.category !== 'mode' && candidate.category !== 'model'
  );
  if (!option || option.type !== 'select') {
    return null;
  }

  const next = flattenSelectOptions(option.options).find(value => value.value !== option.currentValue);
  if (!next) {
    return null;
  }

  return {
    configId: option.id,
    value: next.value,
  };
}

function choosePermissionResponse(
  request: RequestPermissionRequest
): RequestPermissionResponse {
  const rejectOption = request.options.find(
    option => option.kind === 'reject_once' || option.kind === 'reject_always'
  );
  if (!rejectOption) {
    return {
      outcome: {
        outcome: 'cancelled',
      },
    };
  }

  return {
    outcome: {
      outcome: 'selected',
      optionId: rejectOption.optionId,
    },
  };
}

async function waitForCondition(
  predicate: () => boolean,
  timeoutMs: number,
  label: string
): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  throw new Error(`Timed out waiting for ${label} after ${timeoutMs}ms`);
}

function collectTextChunks(updates: SessionUpdate[]): string {
  return updates
    .filter(update => update.sessionUpdate === 'agent_message_chunk')
    .map(update => {
      const content = (update as Extract<SessionUpdate, { sessionUpdate: 'agent_message_chunk' }>).content as ContentBlock & {
        text?: string;
      };
      if (content.type !== 'text') {
        return '';
      }
      return content.text ?? '';
    })
    .join('');
}

async function startRunningAgent(spec: AgentSpec): Promise<RunningAgent> {
  const cwd = mkdtempSync(join(tmpdir(), `acp-sdk-${spec.id}-`));
  const child = spawn(spec.command, spec.args, {
    cwd,
    env: {
      ...process.env,
      ...spec.env,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const stderrLines: string[] = [];
  const sessionUpdates: SessionUpdate[] = [];
  const permissionRequests: RequestPermissionRequest[] = [];

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => {
    stderrLines.push(...String(chunk).split('\n').filter(Boolean));
  });

  const stream = ndJsonStream(
    Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
    Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>
  );

  const connection = new ClientSideConnection(
    () => ({
      sessionUpdate(params: SessionNotification) {
        sessionUpdates.push(params.update);
        return Promise.resolve();
      },
      requestPermission(params: RequestPermissionRequest) {
        permissionRequests.push(params);
        return Promise.resolve(choosePermissionResponse(params));
      },
    }),
    stream
  );

  async function cleanup() {
    try {
      child.kill('SIGTERM');
    } catch {
      // ignore process cleanup failures
    }
    try {
      await Promise.race([
        connection.closed.catch(() => undefined),
        new Promise(resolve => setTimeout(resolve, 1000)),
      ]);
    } catch {
      // ignore close errors
    }
    if (!child.killed) {
      try {
        child.kill('SIGKILL');
      } catch {
        // ignore process cleanup failures
      }
    }
    rmSync(cwd, { recursive: true, force: true });
  }

  return {
    child,
    connection,
    sessionUpdates,
    stderrLines,
    permissionRequests,
    cwd,
    cleanup,
  };
}

const cleanupCallbacks: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanupCallbacks.length > 0) {
    const cleanup = cleanupCallbacks.pop();
    if (cleanup) {
      await cleanup();
    }
  }
});

describe.skipIf(!runRealSdkMatrix)('ACP SDK agent matrix', () => {
  for (const spec of agentMatrix) {
    const skipReason = getSkipReason(spec);

    it.skipIf(Boolean(skipReason))(
      `${spec.id} runs initialize -> newSession -> mutate capabilities -> prompt`,
      { timeout: spec.timeoutMs },
      async () => {
        const running = await startRunningAgent(spec);
        cleanupCallbacks.push(running.cleanup);

        onTestFailed(async () => {
          process.stderr.write(
            `\n[${spec.id}] stderr tail:\n${running.stderrLines.slice(-50).join('\n')}\n`
          );
        });

        const init = await running.connection.initialize({
          protocolVersion: PROTOCOL_VERSION,
          clientCapabilities: {},
          clientInfo: {
            name: 'agentbridge-acp-sdk-matrix',
            version: '0.0.0-test',
          },
        });

        expect(init.protocolVersion).toBe(PROTOCOL_VERSION);

        const session = await running.connection.newSession({
          cwd: running.cwd,
          mcpServers: [],
        });

        expect(session.sessionId).toBeTruthy();

        const alternateMode = pickAlternateMode(session);
        const modeConfig = (session.configOptions ?? []).find(
          option => option.type === 'select' && option.category === 'mode'
        );
        if (alternateMode && modeConfig?.type === 'select') {
          const response = await running.connection.setSessionConfigOption({
            sessionId: session.sessionId,
            configId: modeConfig.id,
            value: alternateMode,
          });

          const updatedModeOption = response.configOptions.find(option => option.id === modeConfig.id);
          expect(updatedModeOption?.type).toBe('select');
          if (updatedModeOption?.type === 'select') {
            expect(updatedModeOption.currentValue).toBe(alternateMode);
          }
        } else if (alternateMode) {
          await running.connection.setSessionMode({
            sessionId: session.sessionId,
            modeId: alternateMode,
          });

          await waitForCondition(
            () =>
              running.sessionUpdates.some(update => {
                return (
                  update.sessionUpdate === 'current_mode_update' &&
                  (update as CurrentModeUpdate).currentModeId === alternateMode
                );
              }),
            10_000,
            `${spec.id} current_mode_update=${alternateMode}`
          );
        }

        const alternateModel = pickAlternateModel(session);
        if (alternateModel) {
          await running.connection.unstable_setSessionModel({
            sessionId: session.sessionId,
            modelId: alternateModel,
          });

          await waitForCondition(
            () =>
              running.sessionUpdates.some(update => {
                if (update.sessionUpdate !== 'config_option_update') {
                  return false;
                }
                const modelOption = (update.configOptions as SessionConfigOption[]).find(option => {
                  return option.type === 'select' && option.category === 'model';
                });
                return modelOption?.type === 'select' && modelOption.currentValue === alternateModel;
              }),
            10_000,
            `${spec.id} model confirmation=${alternateModel}`
          );
        }

        const alternateConfig = pickAlternateConfigOption(session);
        if (alternateConfig) {
          const response = await running.connection.setSessionConfigOption({
            sessionId: session.sessionId,
            configId: alternateConfig.configId,
            value: alternateConfig.value,
          });
          const updatedOption = response.configOptions.find(
            option => option.id === alternateConfig.configId
          );
          expect(updatedOption?.type).toBe('select');
          if (updatedOption?.type === 'select') {
            expect(updatedOption.currentValue).toBe(alternateConfig.value);
          }
        }

        const promptResponse = await running.connection.prompt({
          sessionId: session.sessionId,
          messageId: randomUUID(),
          prompt: [
            {
              type: 'text',
              text: 'Reply with one short sentence containing the exact token ACP_SDK_E2E_OK. Do not use tools.',
            },
          ],
        });

        expect(promptResponse.stopReason).not.toBe('cancelled');
        expect(running.permissionRequests.length).toBe(0);

        await waitForCondition(
          () =>
            running.sessionUpdates.some(update => update.sessionUpdate === 'agent_message_chunk'),
          10_000,
          `${spec.id} agent message chunk`
        );

        const assistantText = collectTextChunks(running.sessionUpdates);
        expect(assistantText.length).toBeGreaterThan(0);
        expect(assistantText).toContain('ACP_SDK_E2E_OK');
      }
    );
  }
});

describe.skipIf(runRealSdkMatrix)('ACP SDK agent matrix', () => {
  it('is gated behind FREE_RUN_ACP_SDK_MATRIX=1', () => {
    expect(true).toBe(true);
  });
});
