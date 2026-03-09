import type { PermissionMode } from '@/api/types';
import type { QueryOptions } from '@/claude/sdk';

/** Derived from SDK's QueryOptions - the modes Claude actually supports */
export type ClaudeSdkPermissionMode = NonNullable<QueryOptions['permissionMode']>;

/**
 * Map unified PermissionMode to Claude SDK values at the SDK boundary.
 *
 * Mapping:
 * - read-only    → default (Claude has no read-only; ask for every action)
 * - accept-edits → acceptEdits
 * - yolo         → bypassPermissions
 */
export function mapToClaudeMode(mode: PermissionMode): ClaudeSdkPermissionMode {
  const map: Record<PermissionMode, ClaudeSdkPermissionMode> = {
    'read-only': 'default',
    'accept-edits': 'acceptEdits',
    yolo: 'bypassPermissions',
  };
  return map[mode] ?? 'default';
}

const VALID_PERMISSION_MODES: readonly PermissionMode[] = [
  'read-only',
  'accept-edits',
  'yolo',
] as const;

function isPermissionMode(value: string | undefined): value is PermissionMode {
  return !!value && VALID_PERMISSION_MODES.includes(value as PermissionMode);
}

/**
 * Extract permission mode override from Claude CLI args.
 * Supports both:
 * - --permission-mode VALUE
 * - --permission-mode=VALUE
 */
export function extractPermissionModeFromClaudeArgs(
  claudeArgs?: string[]
): PermissionMode | undefined {
  if (!claudeArgs || claudeArgs.length === 0) {
    return undefined;
  }

  let found: PermissionMode | undefined = undefined;
  for (let i = 0; i < claudeArgs.length; i++) {
    const arg = claudeArgs[i];
    if (arg === '--permission-mode') {
      const next = claudeArgs[i + 1];
      if (isPermissionMode(next)) {
        found = next;
      }
      i += 1;
      continue;
    }

    if (arg.startsWith('--permission-mode=')) {
      const value = arg.slice('--permission-mode='.length);
      if (isPermissionMode(value)) {
        found = value;
      }
    }
  }

  return found;
}

/**
 * Resolve the initial permission mode for remote Claude execution.
 * `--dangerously-skip-permissions` takes precedence over all other modes.
 */
export function resolveInitialClaudePermissionMode(
  optionMode: PermissionMode | undefined,
  claudeArgs?: string[]
): PermissionMode | undefined {
  if (claudeArgs?.includes('--dangerously-skip-permissions')) {
    return 'yolo';
  }
  return extractPermissionModeFromClaudeArgs(claudeArgs) ?? optionMode;
}

/**
 * Enforce sandbox permission policy for Claude.
 * When sandbox is enabled, we always force bypass permissions.
 */
export function applySandboxPermissionPolicy(
  mode: PermissionMode | undefined,
  sandboxEnabled: boolean
): PermissionMode | undefined {
  if (!sandboxEnabled) {
    return mode;
  }
  return 'yolo';
}
