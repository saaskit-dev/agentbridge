const EXIT_PLAN_TOOLS = new Set(['exit_plan_mode', 'ExitPlanMode']);
const EDIT_TOOLS = new Set([
  'Edit',
  'MultiEdit',
  'Write',
  'NotebookEdit',
  // Gemini/OpenCode lowercase variants
  'edit',
  // ACP patch variants (all now normalized to CodexPatch)
  'CodexPatch',
  'CodexDiff',
]);

export function getToolDescriptor(toolName: string): { edit: boolean; exitPlan: boolean } {
  if (EXIT_PLAN_TOOLS.has(toolName)) {
    return { edit: false, exitPlan: true };
  }
  if (EDIT_TOOLS.has(toolName)) {
    return { edit: true, exitPlan: false };
  }
  return { edit: false, exitPlan: false };
}
