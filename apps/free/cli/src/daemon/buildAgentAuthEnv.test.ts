import { describe, expect, it } from 'vitest';
import { buildAgentAuthEnv } from './buildAgentAuthEnv';
import { configuration } from '@/configuration';

describe('buildAgentAuthEnv', () => {
  it('passes the mobile token through for Claude agents only', () => {
    expect(buildAgentAuthEnv('claude', 'oauth-token')).toEqual({
      CLAUDE_CODE_OAUTH_TOKEN: 'oauth-token',
    });
    expect(buildAgentAuthEnv('claude-acp', 'oauth-token')).toEqual({
      CLAUDE_CODE_OAUTH_TOKEN: 'oauth-token',
    });
  });

  it('does not rewrite Codex auth from the mobile token', () => {
    expect(buildAgentAuthEnv('codex', 'mobile-token')).toEqual({
      HOME: `${configuration.agentHomesDir}/codex`,
      USERPROFILE: `${configuration.agentHomesDir}/codex`,
      CODEX_HOME: `${process.env.CODEX_HOME || process.env.FREE_TEST_ORIGINAL_HOME || process.env.HOME}/.codex`.replace(
        '/.codex/.codex',
        '/.codex'
      ),
    });
    expect(buildAgentAuthEnv('codex-acp', 'mobile-token')).toEqual({
      HOME: `${configuration.agentHomesDir}/codex`,
      USERPROFILE: `${configuration.agentHomesDir}/codex`,
      CODEX_HOME: `${process.env.CODEX_HOME || process.env.FREE_TEST_ORIGINAL_HOME || process.env.HOME}/.codex`.replace(
        '/.codex/.codex',
        '/.codex'
      ),
    });
  });

  it('returns an empty env when no token is provided', () => {
    expect(buildAgentAuthEnv('gemini')).toEqual({});
  });
});
