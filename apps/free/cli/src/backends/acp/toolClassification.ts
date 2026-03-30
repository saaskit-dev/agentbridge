/**
 * Unified Tool Classification for ACP Permission Handling
 *
 * Classifies tools into categories and determines auto-approval based on
 * the unified permission mode. Used by AcpPermissionHandler as the single
 * source of truth for tool approval policy across all ACP-based agents.
 *
 * Uses exact-match Sets for precision — substring matching risks misclassifying
 * tools like "RunCommand" or "RewriteRule". New tools must be explicitly added.
 */

import type { PermissionMode } from '@/api/types';

export type ToolCategory = 'metadata' | 'read' | 'edit' | 'dangerous';

// Tools that are always safe — metadata, thinking, non-actionable
const METADATA_TOOLS = new Set([
  'change_title',
  'free__change_title',
  'mcp__free__change_title',
  'think',
  'save_memory',
  'geminireasoning',
  'codexreasoning',
  'exit_plan_mode',
  'exitplanmode',
]);

// Read-only tools — no side effects
const READ_TOOLS = new Set([
  // Claude Code (PascalCase, lowercased)
  'read',
  'grep',
  'glob',
  'search',
  'ls',
  'websearch',
  'webfetch',
  'taskget',
  'tasklist',
  'toolsearch',
  'lsp',
  'codebase_investigator',
  'investigator',
  'investigate',
  'search_files',
  'find_files',
  // Codex / OpenCode (snake_case)
  'read_file',
  'grep_search',
  'list_directory',
  'file_search',
  // Gemini
  'read_many_files',
]);

// Edit tools — modify files but not dangerous
const EDIT_TOOLS = new Set([
  // Claude Code (PascalCase, lowercased)
  'edit',
  'multiedit',
  'write',
  'notebookedit',
  'patch',
  'diff',
  'codexpatch',
  'codexdiff',
  'create',
  'delete',
  // Codex / OpenCode (snake_case)
  'str_replace_editor',
  'write_to_file',
  'create_file',
  'delete_file',
  'insert_edit_into_file',
]);

// Dangerous tools — shell execution, process control
const DANGEROUS_TOOLS = new Set([
  // Claude Code (PascalCase, lowercased)
  'bash',
  'shell',
  'command',
  'execute',
  'createterminal',
  // Codex / OpenCode (snake_case)
  'run_terminal_cmd',
  'run_bash_command',
  'execute_command',
]);

export function classifyTool(toolName: string): ToolCategory {
  const lower = toolName.toLowerCase();

  // Priority: metadata > dangerous > edit > read.
  // Dangerous before edit ensures ambiguous tools default to stricter classification.
  if (METADATA_TOOLS.has(lower)) return 'metadata';
  if (DANGEROUS_TOOLS.has(lower)) return 'dangerous';
  if (EDIT_TOOLS.has(lower)) return 'edit';
  if (READ_TOOLS.has(lower)) return 'read';

  // Unknown tools default to edit — truly dangerous tools (bash/shell/exec) are
  // explicitly listed in DANGEROUS_TOOLS. Anything not recognized is more likely
  // a custom agent tool or a new agent version tool, which fits edit-level semantics:
  // still blocked in read-only mode, auto-approved in accept-edits/yolo.
  return 'edit';
}

/**
 * Determine if a tool should be auto-approved based on permission mode.
 *
 * | Category  | read-only | accept-edits | yolo |
 * |-----------|-----------|-------------|------|
 * | metadata  | ✅ auto   | ✅ auto     | ✅   |
 * | read      | ✅ auto   | ✅ auto     | ✅   |
 * | edit      | ❌ ask    | ✅ auto     | ✅   |
 * | dangerous | ❌ ask    | ❌ ask      | ✅   |
 */
export function shouldAutoApprove(
  toolName: string,
  permissionMode: PermissionMode,
): boolean {
  const category = classifyTool(toolName);

  switch (category) {
    case 'metadata':
    case 'read':
      return true;
    case 'edit':
      return permissionMode === 'accept-edits' || permissionMode === 'yolo';
    case 'dangerous':
      return permissionMode === 'yolo';
  }
}
