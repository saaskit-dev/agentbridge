/**
 * Centralized permission projection for ACP agent modes.
 *
 * ACP sessions always exchange native mode IDs with the agent. We only consult
 * this table when:
 * 1. choosing a default native mode for a requested PermissionMode, or
 * 2. projecting the current native mode into our permission handler.
 *
 * Not every native mode maps cleanly to our three PermissionMode values. Those
 * modes are intentionally omitted from the reverse mapping so permission
 * handling can fall back to the conservative path.
 */

import type { PermissionMode } from '@/api/types';

export const ACP_AGENT_TYPES = ['claude', 'codex', 'gemini', 'cursor', 'opencode'] as const;

export type AcpAgentType = (typeof ACP_AGENT_TYPES)[number];

type AgentModeMapping = {
  /** PermissionMode → preferred agent native mode ID */
  forward: Partial<Record<PermissionMode, string>>;
  /** agent native mode ID → PermissionMode (mapped modes only) */
  reverse: Record<string, PermissionMode>;
};

const AGENT_MODE_MAPPINGS: Record<AcpAgentType, AgentModeMapping> = {
  claude: {
    forward: {
      'read-only': 'default',
      'accept-edits': 'acceptEdits',
      'yolo': 'bypassPermissions',
    },
    reverse: {
      'default': 'read-only',
      'acceptEdits': 'accept-edits',
      'bypassPermissions': 'yolo',
    },
  },
  codex: {
    forward: {
      'read-only': 'read-only',
      'accept-edits': 'auto',
      'yolo': 'full-access',
    },
    reverse: {
      'read-only': 'read-only',
      'auto': 'accept-edits',
      'full-access': 'yolo',
    },
  },
  gemini: {
    forward: {
      'read-only': 'default',
      'accept-edits': 'autoEdit',
      'yolo': 'yolo',
    },
    reverse: {
      'default': 'read-only',
      'autoEdit': 'accept-edits',
      'yolo': 'yolo',
    },
  },
  cursor: {
    forward: {
      'read-only': 'ask',
      'yolo': 'agent',
    },
    reverse: {
      'ask': 'read-only',
      'agent': 'yolo',
    },
  },
  opencode: {
    forward: {},
    reverse: {},
  },
};

export function getAgentModeMappingsForTest(): Readonly<Record<AcpAgentType, AgentModeMapping>> {
  return AGENT_MODE_MAPPINGS;
}

function isAcpAgentType(agentType: string): agentType is AcpAgentType {
  return ACP_AGENT_TYPES.includes(agentType as AcpAgentType);
}

/**
 * Get the agent native mode ID for a given permission mode.
 * Returns null if the agent type is unknown or the target mode
 * is not in the agent's available modes.
 */
export function getAgentModeForPermission(
  agentType: string,
  permissionMode: PermissionMode,
  availableModes: string[],
): string | null {
  if (!isAcpAgentType(agentType)) return null;
  const mapping = AGENT_MODE_MAPPINGS[agentType];

  const targetMode = mapping.forward[permissionMode];
  if (!targetMode) return null;

  // Only return if the agent actually has this mode available
  if (availableModes.length > 0 && !availableModes.includes(targetMode)) {
    return null;
  }

  return targetMode;
}

/**
 * Project an agent's native mode into the unified permission system.
 * Returns null when the mode carries no stable permission meaning.
 */
export function getPermissionModeForAgentMode(
  agentType: string,
  nativeModeId: string,
): PermissionMode | null {
  if (!isAcpAgentType(agentType)) return null;
  const mapping = AGENT_MODE_MAPPINGS[agentType];

  return mapping.reverse[nativeModeId] ?? null;
}
