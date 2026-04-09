export type DisplayAgentFlavor = 'claude' | 'codex' | 'gemini' | 'opencode' | 'cursor';
export type KnownAgentType = 'claude' | 'codex' | 'gemini' | 'opencode' | 'cursor';
export type AppAgentFlavor = KnownAgentType | string;
export type SessionFlavor = AppAgentFlavor | 'gpt' | 'openai';

export function normalizeAgentFlavor(flavor: SessionFlavor | null | undefined): DisplayAgentFlavor {
  if (flavor === 'claude') return 'claude';
  if (flavor === 'codex' || flavor === 'gpt' || flavor === 'openai') {
    return 'codex';
  }
  if (flavor === 'gemini') return 'gemini';
  if (flavor === 'opencode') return 'opencode';
  if (flavor === 'cursor') return 'cursor';
  return 'claude';
}

export function getCapabilityPresetFlavor(
  flavor: SessionFlavor | null | undefined
): DisplayAgentFlavor | null {
  if (flavor === 'gemini') return 'gemini';
  if (flavor === 'opencode') return 'opencode';
  if (flavor === 'cursor') return 'cursor';
  return null;
}

export function usesAcpPermissionDecisions(flavor: SessionFlavor | null | undefined): boolean {
  return Boolean(flavor);
}

export function coerceAgentType(flavor: unknown): AppAgentFlavor {
  if (typeof flavor !== 'string' || !flavor.trim()) {
    return 'claude';
  }
  if (
    flavor === 'claude' ||
    flavor === 'codex' ||
    flavor === 'gemini' ||
    flavor === 'opencode' ||
    flavor === 'cursor'
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
  if (agentType === 'codex') return 'Codex';
  if (agentType === 'gemini') return 'Gemini';
  if (agentType === 'opencode') return 'OpenCode';
  if (agentType === 'cursor') return 'Cursor';
  return agentType
    .split('-')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function getAgentDescription(agentType: AppAgentFlavor): string {
  if (agentType === 'claude') return 'Claude via ACP';
  if (agentType === 'codex') return 'Codex via ACP';
  if (agentType === 'gemini') return 'Gemini via ACP';
  if (agentType === 'opencode') return 'OpenCode via ACP';
  if (agentType === 'cursor') return 'Cursor via ACP';
  return 'Daemon-registered agent';
}

export function isAcpAgent(flavor: SessionFlavor | null | undefined): boolean {
  return (
    flavor === 'claude' ||
    flavor === 'codex' ||
    flavor === 'gemini' ||
    flavor === 'opencode' ||
    flavor === 'cursor'
  );
}

export function isExperimentalAgent(agentType: AppAgentFlavor): boolean {
  return agentType === 'gemini' || agentType === 'opencode' || agentType === 'cursor';
}

export function isHiddenAgentOption(agentType: AppAgentFlavor): boolean {
  return false;
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
