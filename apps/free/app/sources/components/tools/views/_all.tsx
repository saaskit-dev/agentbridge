import { EditViewFull } from './EditViewFull';
import { MultiEditViewFull } from './MultiEditViewFull';
import { CodexBashView } from './CodexBashView';
import { CodexPatchView } from './CodexPatchView';
import { CodexDiffView } from './CodexDiffView';
import { AskUserQuestionView } from './AskUserQuestionView';
import { BashView } from './BashView';
import { BashViewFull } from './BashViewFull';
import { EditView } from './EditView';
import { ExitPlanToolView } from './ExitPlanToolView';
import { GeminiEditView } from './GeminiEditView';
import { GeminiExecuteView } from './GeminiExecuteView';
import { MultiEditView } from './MultiEditView';
import { TaskView } from './TaskView';
import { TodoView } from './TodoView';
import { WriteView } from './WriteView';
import type { ToolViewComponent } from './types';

export type { ToolViewProps, ToolViewComponent } from './types';

// Registry of tool-specific view components
export const toolViewRegistry: Record<string, ToolViewComponent> = {
  Edit: EditView,
  Bash: BashView,
  CodexBash: CodexBashView,
  CodexPatch: CodexPatchView,
  CodexDiff: CodexDiffView,
  Write: WriteView,
  TodoWrite: TodoView,
  ExitPlanMode: ExitPlanToolView,
  exit_plan_mode: ExitPlanToolView,
  MultiEdit: MultiEditView,
  Task: TaskView,
  AskUserQuestion: AskUserQuestionView,
  // Gemini tools (lowercase)
  edit: GeminiEditView,
  execute: GeminiExecuteView,
};

export const toolFullViewRegistry: Record<string, ToolViewComponent> = {
  Bash: BashViewFull,
  Edit: EditViewFull,
  MultiEdit: MultiEditViewFull,
};

// Helper function to get the appropriate view component for a tool
export function getToolViewComponent(toolName: string): ToolViewComponent | null {
  return toolViewRegistry[toolName] || null;
}

// Helper function to get the full view component for a tool
export function getToolFullViewComponent(toolName: string): ToolViewComponent | null {
  return toolFullViewRegistry[toolName] || null;
}

// Export individual components
export { EditView } from './EditView';
export { BashView } from './BashView';
export { CodexBashView } from './CodexBashView';
export { CodexPatchView } from './CodexPatchView';
export { CodexDiffView } from './CodexDiffView';
export { BashViewFull } from './BashViewFull';
export { EditViewFull } from './EditViewFull';
export { MultiEditViewFull } from './MultiEditViewFull';
export { ExitPlanToolView } from './ExitPlanToolView';
export { MultiEditView } from './MultiEditView';
export { TaskView } from './TaskView';
export { AskUserQuestionView } from './AskUserQuestionView';
export { GeminiEditView } from './GeminiEditView';
export { GeminiExecuteView } from './GeminiExecuteView';
