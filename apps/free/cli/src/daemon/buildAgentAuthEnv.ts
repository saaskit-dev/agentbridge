import { existsSync, mkdirSync, readdirSync, symlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { configuration } from '@/configuration';
import type { AgentType } from '@/daemon/sessions/types';

function ensureCodexOverlayHome(realHome: string, overlayHome: string): void {
  mkdirSync(overlayHome, { recursive: true });

  for (const entry of readdirSync(realHome)) {
    if (entry === '.agents') {
      continue;
    }

    const target = join(overlayHome, entry);
    if (existsSync(target)) {
      continue;
    }

    symlinkSync(join(realHome, entry), target);
  }
}

function buildCodexEnv(): Record<string, string> {
  const realHome = process.env.FREE_TEST_ORIGINAL_HOME || homedir();
  const codexHome = process.env.CODEX_HOME || join(realHome, '.codex');
  const overlayHome = join(configuration.agentHomesDir, 'codex');

  ensureCodexOverlayHome(realHome, overlayHome);

  return {
    HOME: overlayHome,
    USERPROFILE: overlayHome,
    CODEX_HOME: codexHome,
  };
}

export function buildAgentAuthEnv(agentType: AgentType, token?: string): Record<string, string> {
  if (agentType === 'codex') {
    return buildCodexEnv();
  }

  if (!token) {
    return {};
  }

  if (agentType === 'claude-native' || agentType === 'claude') {
    return {
      CLAUDE_CODE_OAUTH_TOKEN: token,
    };
  }

  return {};
}
