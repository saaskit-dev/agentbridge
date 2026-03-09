import type { PermissionMode } from '@/api/types';

export type { PermissionMode } from '@/api/types';

export type JsRuntime = 'node' | 'bun';

export interface EnhancedMode {
  permissionMode: PermissionMode;
  model?: string;
  fallbackModel?: string;
  customSystemPrompt?: string;
  appendSystemPrompt?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
}
