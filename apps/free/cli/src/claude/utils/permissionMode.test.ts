import { describe, it, expect } from 'vitest';
import {
  applySandboxPermissionPolicy,
  extractPermissionModeFromClaudeArgs,
  mapToClaudeMode,
  resolveInitialClaudePermissionMode,
} from './permissionMode';

describe('mapToClaudeMode', () => {
  it('maps read-only → default (Claude has no read-only)', () => {
    expect(mapToClaudeMode('read-only')).toBe('default');
  });

  it('maps accept-edits → acceptEdits', () => {
    expect(mapToClaudeMode('accept-edits')).toBe('acceptEdits');
  });

  it('maps yolo → bypassPermissions', () => {
    expect(mapToClaudeMode('yolo')).toBe('bypassPermissions');
  });

  it('returns a valid Claude SDK mode for every PermissionMode', () => {
    const validClaudeModes = ['default', 'acceptEdits', 'bypassPermissions', 'plan'];
    (['read-only', 'accept-edits', 'yolo'] as const).forEach(mode => {
      expect(validClaudeModes).toContain(mapToClaudeMode(mode));
    });
  });
});

describe('extractPermissionModeFromClaudeArgs', () => {
  it('extracts mode from --permission-mode VALUE', () => {
    expect(extractPermissionModeFromClaudeArgs(['--permission-mode', 'yolo'])).toBe('yolo');
  });

  it('extracts mode from --permission-mode=VALUE', () => {
    expect(extractPermissionModeFromClaudeArgs(['--foo', '--permission-mode=read-only'])).toBe(
      'read-only'
    );
  });

  it('returns undefined for invalid mode', () => {
    expect(extractPermissionModeFromClaudeArgs(['--permission-mode', 'invalid'])).toBeUndefined();
  });
});

describe('resolveInitialClaudePermissionMode', () => {
  it('uses --dangerously-skip-permissions as highest priority', () => {
    expect(
      resolveInitialClaudePermissionMode('accept-edits', [
        '--permission-mode',
        'read-only',
        '--dangerously-skip-permissions',
      ])
    ).toBe('yolo');
  });

  it('uses mode from claude args when present', () => {
    expect(
      resolveInitialClaudePermissionMode('accept-edits', ['--permission-mode', 'accept-edits'])
    ).toBe('accept-edits');
  });

  it('falls back to option mode when claude args have no mode', () => {
    expect(resolveInitialClaudePermissionMode('yolo', ['--foo'])).toBe('yolo');
  });
});

describe('applySandboxPermissionPolicy', () => {
  it('forces yolo when sandbox is enabled', () => {
    expect(applySandboxPermissionPolicy('accept-edits', true)).toBe('yolo');
    expect(applySandboxPermissionPolicy(undefined, true)).toBe('yolo');
  });

  it('forces yolo for read-only mode when sandbox is enabled', () => {
    expect(applySandboxPermissionPolicy('read-only', true)).toBe('yolo');
  });

  it('returns original mode when sandbox is disabled', () => {
    expect(applySandboxPermissionPolicy('accept-edits', false)).toBe('accept-edits');
  });
});
