import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { Readable, Writable } from 'node:stream';
import {
  ClientSideConnection,
  PROTOCOL_VERSION,
  ndJsonStream,
  type InitializeResponse,
  type ListSessionsResponse,
} from '@agentclientprotocol/sdk';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';
import type { AgentType } from '@/daemon/sessions/types';
import { buildAgentAuthEnv } from '@/daemon/buildAgentAuthEnv';

const logger = new Logger('daemon/externalSessions/listExternalSessions');

export type ExternalAgentSessionSummary = {
  agentType: AgentType;
  sessionId: string;
  cwd: string;
  title?: string | null;
  updatedAt?: string | null;
};

export type ExternalAgentSessionsResult = {
  sessions: ExternalAgentSessionSummary[];
  listableAgents: AgentType[];
  errors: Array<{ agentType: AgentType; error: string }>;
  cachedAt: number;
};

type AgentSpec = {
  agentType: AgentType;
  command: string;
  args: string[];
  env?: Record<string, string>;
};

const CODEX_ACP_VERSION = '0.9.5';
const CACHE_TTL_MS = 30_000;

let cache:
  | {
      key: string;
      value: ExternalAgentSessionsResult;
      expiresAt: number;
    }
  | null = null;

function getCodexAcpPlatformPackage(): string | null {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === 'darwin' && arch === 'arm64') return '@zed-industries/codex-acp-darwin-arm64';
  if (platform === 'darwin' && arch === 'x64') return '@zed-industries/codex-acp-darwin-x64';
  if (platform === 'linux' && arch === 'arm64') return '@zed-industries/codex-acp-linux-arm64';
  if (platform === 'linux' && arch === 'x64') return '@zed-industries/codex-acp-linux-x64';
  if (platform === 'win32' && arch === 'arm64') return '@zed-industries/codex-acp-win32-arm64';
  if (platform === 'win32' && arch === 'x64') return '@zed-industries/codex-acp-win32-x64';
  return null;
}

function getCodexAcpCommandArgs(): string[] {
  const mainPackage = `@zed-industries/codex-acp@${CODEX_ACP_VERSION}`;
  const platformPackage = getCodexAcpPlatformPackage();
  return platformPackage
    ? ['-y', '-p', mainPackage, '-p', `${platformPackage}@${CODEX_ACP_VERSION}`, 'codex-acp']
    : ['-y', mainPackage, 'codex-acp'];
}

function getAgentSpec(agentType: AgentType, token?: string): AgentSpec | null {
  const authEnv = buildAgentAuthEnv(agentType, token);

  if (agentType === 'claude') {
    return {
      agentType,
      command: 'npx',
      args: ['-y', '@zed-industries/claude-agent-acp'],
      env: authEnv,
    };
  }

  if (agentType === 'codex') {
    return {
      agentType,
      command: 'npx',
      args: getCodexAcpCommandArgs(),
      env: authEnv,
    };
  }

  if (agentType === 'opencode') {
    return {
      agentType,
      command: 'opencode',
      args: ['acp'],
      env: authEnv,
    };
  }

  return null;
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

async function listSessionsForSpec(spec: AgentSpec): Promise<ExternalAgentSessionSummary[]> {
  const cwd = await mkdtemp(join(tmpdir(), `agentbridge-list-${spec.agentType}-`));
  let child: ChildProcessWithoutNullStreams | null = null;

  try {
    child = spawn(spec.command, spec.args, {
      cwd,
      env: {
        ...process.env,
        ...(spec.env ?? {}),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const stderrLines: string[] = [];
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => {
      stderrLines.push(...String(chunk).split('\n').filter(Boolean));
    });

    const stream = ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>);
    const connection = new ClientSideConnection(
      () => ({
        sessionUpdate() {
          return Promise.resolve();
        },
        requestPermission() {
          return Promise.resolve({ outcome: { outcome: 'cancelled' } });
        },
      }),
      stream
    );

    const init = (await withTimeout(
      connection.initialize({
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {},
        clientInfo: { name: 'agentbridge-external-sessions', version: '0.0.0' },
      }),
      120_000,
      `${spec.agentType} initialize`
    )) as InitializeResponse;

    if (!init.agentCapabilities?.sessionCapabilities?.list) {
      return [];
    }

    const sessions: ExternalAgentSessionSummary[] = [];
    let cursor: string | null | undefined = undefined;

    do {
      const response = (await withTimeout(
        connection.listSessions({ cursor: cursor ?? undefined }),
        30_000,
        `${spec.agentType} listSessions`
      )) as ListSessionsResponse;

      for (const session of response.sessions ?? []) {
        sessions.push({
          agentType: spec.agentType,
          sessionId: session.sessionId,
          cwd: session.cwd,
          title: session.title ?? null,
          updatedAt: session.updatedAt ?? null,
        });
      }

      cursor = response.nextCursor ?? null;
    } while (cursor);

    return sessions;
  } catch (error) {
    logger.warn('[externalSessions] list failed', {
      agentType: spec.agentType,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    if (child) {
      try {
        child.kill('SIGTERM');
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 300));
      try {
        child.kill('SIGKILL');
      } catch {}
    }
    await rm(cwd, { recursive: true, force: true });
  }
}

export async function listExternalAgentSessions(
  agentTypes: AgentType[],
  token?: string,
  forceRefresh = false
): Promise<ExternalAgentSessionsResult> {
  const cacheKey = JSON.stringify({ agentTypes: [...agentTypes].sort(), token: Boolean(token) });
  if (!forceRefresh && cache && cache.key === cacheKey && cache.expiresAt > Date.now()) {
    return cache.value;
  }
  const sessions: ExternalAgentSessionSummary[] = [];
  const listableAgents: AgentType[] = [];
  const errors: Array<{ agentType: AgentType; error: string }> = [];

  for (const agentType of agentTypes) {
    const spec = getAgentSpec(agentType, token);
    if (!spec) continue;

    try {
      const agentSessions = await listSessionsForSpec(spec);
      listableAgents.push(agentType);
      sessions.push(...agentSessions);
    } catch (error) {
      errors.push({
        agentType,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  sessions.sort((a, b) => {
    const aTime = a.updatedAt ? Date.parse(a.updatedAt) : 0;
    const bTime = b.updatedAt ? Date.parse(b.updatedAt) : 0;
    return bTime - aTime;
  });

  const value = { sessions, listableAgents, errors, cachedAt: Date.now() };
  cache = {
    key: cacheKey,
    value,
    expiresAt: Date.now() + CACHE_TTL_MS,
  };
  return value;
}
