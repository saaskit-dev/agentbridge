export type DisplayAgentFlavor = 'claude' | 'codex' | 'gemini' | 'opencode';
export type KnownAgentType =
  | 'claude'
  | 'claude-acp'
  | 'codex'
  | 'codex-acp'
  | 'gemini'
  | 'opencode';
export type AppAgentFlavor = KnownAgentType | string;
export type SessionFlavor = AppAgentFlavor | 'gpt' | 'openai';

export function normalizeAgentFlavor(
  flavor: SessionFlavor | null | undefined
): DisplayAgentFlavor {
  if (flavor === 'claude' || flavor === 'claude-acp') return 'claude';
  if (flavor === 'codex' || flavor === 'codex-acp' || flavor === 'gpt' || flavor === 'openai') {
    return 'codex';
  }
  if (flavor === 'gemini') return 'gemini';
  if (flavor === 'opencode') return 'opencode';
  return 'claude';
}

export function getCapabilityPresetFlavor(
  flavor: SessionFlavor | null | undefined
): DisplayAgentFlavor | null {
  if (flavor === 'claude') return 'claude';
  if (flavor === 'codex' || flavor === 'gpt' || flavor === 'openai') return 'codex';
  if (flavor === 'gemini') return 'gemini';
  if (flavor === 'opencode') return 'opencode';
  return null;
}

export function usesAcpPermissionDecisions(
  flavor: SessionFlavor | null | undefined
): boolean {
  if (!flavor) {
    return false;
  }
  if (flavor === 'claude') {
    return false;
  }
  return true;
}

export function coerceAgentType(flavor: unknown): AppAgentFlavor {
  if (typeof flavor !== 'string' || !flavor.trim()) {
    return 'claude';
  }
  if (
    flavor === 'claude' ||
    flavor === 'claude-acp' ||
    flavor === 'codex' ||
    flavor === 'codex-acp' ||
    flavor === 'gemini' ||
    flavor === 'opencode'
  ) {
    return flavor;
  }
  if (flavor === 'gpt' || flavor === 'openai') {
    return 'codex';
  }
  return flavor;
}

export function getAgentDisplayName(agentType: AppAgentFlavor): string {
  if (agentType === 'claude') return 'Claude';
  if (agentType === 'claude-acp') return 'Claude ACP';
  if (agentType === 'codex') return 'Codex';
  if (agentType === 'codex-acp') return 'Codex ACP';
  if (agentType === 'gemini') return 'Gemini';
  if (agentType === 'opencode') return 'OpenCode';
  return agentType
    .split('-')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function getAgentDescription(agentType: AppAgentFlavor): string {
  if (agentType === 'claude') return 'Claude legacy backend';
  if (agentType === 'claude-acp') return 'Claude via ACP';
  if (agentType === 'codex') return 'Codex legacy backend';
  if (agentType === 'codex-acp') return 'Codex via ACP';
  if (agentType === 'gemini') return 'Gemini via ACP';
  if (agentType === 'opencode') return 'OpenCode via ACP';
  return 'Daemon-registered agent';
}

export function isAcpAgent(flavor: SessionFlavor | null | undefined): boolean {
  return (
    flavor === 'claude-acp' ||
    flavor === 'codex-acp' ||
    flavor === 'gemini' ||
    flavor === 'opencode'
  );
}

export function isExperimentalAgent(agentType: AppAgentFlavor): boolean {
  return agentType === 'claude' || agentType === 'codex';
}

export function isAgentFlavorMatch(
  requestedAgentType: AppAgentFlavor,
  actualFlavor: SessionFlavor | null | undefined
): boolean {
  if (requestedAgentType === 'codex') {
    return actualFlavor === 'codex' || actualFlavor === 'gpt' || actualFlavor === 'openai';
  }
  return actualFlavor === requestedAgentType;
}
