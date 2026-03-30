import { describe, it, expect } from 'vitest';
import { classifyTool, shouldAutoApprove, type ToolCategory } from './toolClassification';

describe('classifyTool', () => {
  const cases: Array<[string, ToolCategory]> = [
    // metadata
    ['change_title', 'metadata'],
    ['free__change_title', 'metadata'],
    ['think', 'metadata'],
    ['save_memory', 'metadata'],
    ['GeminiReasoning', 'metadata'],
    ['CodexReasoning', 'metadata'],
    ['ExitPlanMode', 'metadata'],
    ['exit_plan_mode', 'metadata'],

    // read — Claude Code (PascalCase)
    ['Read', 'read'],
    ['Grep', 'read'],
    ['Glob', 'read'],
    ['WebSearch', 'read'],
    ['WebFetch', 'read'],
    ['LS', 'read'],
    ['TaskGet', 'read'],
    ['TaskList', 'read'],
    ['ToolSearch', 'read'],
    ['codebase_investigator', 'read'],
    ['search_files', 'read'],
    // read — Codex / OpenCode (snake_case)
    ['read_file', 'read'],
    ['grep_search', 'read'],
    ['list_directory', 'read'],
    ['file_search', 'read'],
    // read — Gemini
    ['read_many_files', 'read'],

    // edit — Claude Code (PascalCase)
    ['Edit', 'edit'],
    ['MultiEdit', 'edit'],
    ['Write', 'edit'],
    ['NotebookEdit', 'edit'],
    ['CodexPatch', 'edit'],
    ['CodexDiff', 'edit'],
    // edit — Codex / OpenCode (snake_case)
    ['str_replace_editor', 'edit'],
    ['write_to_file', 'edit'],
    ['create_file', 'edit'],
    ['delete_file', 'edit'],
    ['insert_edit_into_file', 'edit'],

    // dangerous — Claude Code
    ['Bash', 'dangerous'],
    ['shell', 'dangerous'],
    ['command', 'dangerous'],
    ['execute', 'dangerous'],
    // dangerous — Codex / OpenCode (snake_case)
    ['run_terminal_cmd', 'dangerous'],
    ['run_bash_command', 'dangerous'],
    ['execute_command', 'dangerous'],

    // unknown → edit (dangerous tools are explicitly listed; unknowns are treated as edit-level)
    ['SomeUnknownTool', 'edit'],
    ['Agent', 'edit'],
  ];

  it.each(cases)('classifies %s as %s', (toolName, expected) => {
    expect(classifyTool(toolName)).toBe(expected);
  });
});

describe('shouldAutoApprove', () => {
  describe('read-only mode', () => {
    it('auto-approves metadata tools', () => {
      expect(shouldAutoApprove('change_title', 'read-only')).toBe(true);
      expect(shouldAutoApprove('think', 'read-only')).toBe(true);
    });

    it('auto-approves read tools', () => {
      expect(shouldAutoApprove('Read', 'read-only')).toBe(true);
      expect(shouldAutoApprove('Grep', 'read-only')).toBe(true);
    });

    it('does NOT auto-approve edit tools', () => {
      expect(shouldAutoApprove('Edit', 'read-only')).toBe(false);
      expect(shouldAutoApprove('Write', 'read-only')).toBe(false);
    });

    it('does NOT auto-approve dangerous tools', () => {
      expect(shouldAutoApprove('Bash', 'read-only')).toBe(false);
    });
  });

  describe('accept-edits mode', () => {
    it('auto-approves metadata tools', () => {
      expect(shouldAutoApprove('change_title', 'accept-edits')).toBe(true);
    });

    it('auto-approves read tools', () => {
      expect(shouldAutoApprove('Read', 'accept-edits')).toBe(true);
    });

    it('auto-approves edit tools', () => {
      expect(shouldAutoApprove('Edit', 'accept-edits')).toBe(true);
      expect(shouldAutoApprove('Write', 'accept-edits')).toBe(true);
      expect(shouldAutoApprove('MultiEdit', 'accept-edits')).toBe(true);
      expect(shouldAutoApprove('NotebookEdit', 'accept-edits')).toBe(true);
      expect(shouldAutoApprove('CodexPatch', 'accept-edits')).toBe(true);
    });

    it('does NOT auto-approve dangerous tools', () => {
      expect(shouldAutoApprove('Bash', 'accept-edits')).toBe(false);
      expect(shouldAutoApprove('shell', 'accept-edits')).toBe(false);
    });
  });

  describe('yolo mode', () => {
    it('auto-approves everything', () => {
      expect(shouldAutoApprove('change_title', 'yolo')).toBe(true);
      expect(shouldAutoApprove('Read', 'yolo')).toBe(true);
      expect(shouldAutoApprove('Edit', 'yolo')).toBe(true);
      expect(shouldAutoApprove('Bash', 'yolo')).toBe(true);
      expect(shouldAutoApprove('SomeUnknownTool', 'yolo')).toBe(true);
    });
  });

  describe('unknown tools default to edit', () => {
    it('asks in read-only (edit tools are blocked)', () => {
      expect(shouldAutoApprove('MysteryTool', 'read-only')).toBe(false);
    });

    it('auto-approves in accept-edits (edit-level tools are allowed)', () => {
      expect(shouldAutoApprove('MysteryTool', 'accept-edits')).toBe(true);
    });

    it('auto-approves in yolo', () => {
      expect(shouldAutoApprove('MysteryTool', 'yolo')).toBe(true);
    });
  });
});
