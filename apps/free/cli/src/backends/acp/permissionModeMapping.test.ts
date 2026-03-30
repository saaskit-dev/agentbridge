import { describe, it, expect } from 'vitest';
import {
  getAgentModeForPermission,
  getPermissionModeForAgentMode,
} from './permissionModeMapping';

describe('getAgentModeForPermission', () => {
  describe('claude', () => {
    const modes = ['default', 'acceptEdits', 'plan', 'dontAsk', 'bypassPermissions'];

    it('maps read-only → default', () => {
      expect(getAgentModeForPermission('claude', 'read-only', modes)).toBe('default');
    });
    it('maps accept-edits → acceptEdits', () => {
      expect(getAgentModeForPermission('claude', 'accept-edits', modes)).toBe('acceptEdits');
    });
    it('maps yolo → bypassPermissions', () => {
      expect(getAgentModeForPermission('claude', 'yolo', modes)).toBe('bypassPermissions');
    });
  });

  describe('codex', () => {
    const modes = ['read-only', 'auto', 'full-access'];

    it('maps read-only → read-only', () => {
      expect(getAgentModeForPermission('codex', 'read-only', modes)).toBe('read-only');
    });
    it('maps accept-edits → auto', () => {
      expect(getAgentModeForPermission('codex', 'accept-edits', modes)).toBe('auto');
    });
    it('maps yolo → full-access', () => {
      expect(getAgentModeForPermission('codex', 'yolo', modes)).toBe('full-access');
    });
  });

  describe('gemini', () => {
    const modes = ['default', 'autoEdit', 'yolo', 'plan'];

    it('maps each permission mode to its native mode', () => {
      expect(getAgentModeForPermission('gemini', 'read-only', modes)).toBe('default');
      expect(getAgentModeForPermission('gemini', 'accept-edits', modes)).toBe('autoEdit');
      expect(getAgentModeForPermission('gemini', 'yolo', modes)).toBe('yolo');
    });
  });

  describe('cursor', () => {
    const modes = ['agent', 'plan', 'ask'];

    it('maps read-only → ask', () => {
      expect(getAgentModeForPermission('cursor', 'read-only', modes)).toBe('ask');
    });
    it('returns null for accept-edits because cursor has no separate mode', () => {
      expect(getAgentModeForPermission('cursor', 'accept-edits', modes)).toBeNull();
    });
    it('maps yolo → agent', () => {
      expect(getAgentModeForPermission('cursor', 'yolo', modes)).toBe('agent');
    });
  });

  describe('opencode', () => {
    const modes = ['build', 'plan'];

    it('returns null because opencode modes are not projected forward', () => {
      expect(getAgentModeForPermission('opencode', 'read-only', modes)).toBeNull();
      expect(getAgentModeForPermission('opencode', 'accept-edits', modes)).toBeNull();
      expect(getAgentModeForPermission('opencode', 'yolo', modes)).toBeNull();
    });
  });

  describe('edge cases', () => {
    it('returns null for unknown agent type', () => {
      expect(getAgentModeForPermission('unknown-agent', 'yolo', ['some-mode'])).toBeNull();
    });

    it('returns null when target mode is not in available modes', () => {
      // Claude's bypassPermissions is not in the available list
      expect(getAgentModeForPermission('claude', 'yolo', ['default', 'plan'])).toBeNull();
    });

    it('returns the mode when availableModes is empty (not yet discovered)', () => {
      expect(getAgentModeForPermission('claude', 'yolo', [])).toBe('bypassPermissions');
    });
  });
});

describe('getPermissionModeForAgentMode', () => {
  describe('claude', () => {
    it('maps default → read-only', () => {
      expect(getPermissionModeForAgentMode('claude', 'default')).toBe('read-only');
    });
    it('maps acceptEdits → accept-edits', () => {
      expect(getPermissionModeForAgentMode('claude', 'acceptEdits')).toBe('accept-edits');
    });
    it('maps bypassPermissions → yolo', () => {
      expect(getPermissionModeForAgentMode('claude', 'bypassPermissions')).toBe('yolo');
    });
    it('returns null for plan because it is not a permission mode', () => {
      expect(getPermissionModeForAgentMode('claude', 'plan')).toBeNull();
    });
    it('returns null for dontAsk because it is not a permission mode', () => {
      expect(getPermissionModeForAgentMode('claude', 'dontAsk')).toBeNull();
    });
  });

  describe('codex', () => {
    it('maps read-only → read-only', () => {
      expect(getPermissionModeForAgentMode('codex', 'read-only')).toBe('read-only');
    });
    it('maps auto → accept-edits', () => {
      expect(getPermissionModeForAgentMode('codex', 'auto')).toBe('accept-edits');
    });
    it('maps full-access → yolo', () => {
      expect(getPermissionModeForAgentMode('codex', 'full-access')).toBe('yolo');
    });
  });

  describe('cursor', () => {
    it('maps agent → yolo', () => {
      expect(getPermissionModeForAgentMode('cursor', 'agent')).toBe('yolo');
    });
    it('maps ask → read-only', () => {
      expect(getPermissionModeForAgentMode('cursor', 'ask')).toBe('read-only');
    });
    it('returns null for plan because it is not a permission mode', () => {
      expect(getPermissionModeForAgentMode('cursor', 'plan')).toBeNull();
    });
  });

  describe('gemini', () => {
    it('maps default → read-only', () => {
      expect(getPermissionModeForAgentMode('gemini', 'default')).toBe('read-only');
    });
    it('maps autoEdit → accept-edits', () => {
      expect(getPermissionModeForAgentMode('gemini', 'autoEdit')).toBe('accept-edits');
    });
    it('maps yolo → yolo', () => {
      expect(getPermissionModeForAgentMode('gemini', 'yolo')).toBe('yolo');
    });
    it('returns null for plan because it is not a permission mode', () => {
      expect(getPermissionModeForAgentMode('gemini', 'plan')).toBeNull();
    });
  });

  describe('opencode', () => {
    it('returns null for every current native mode', () => {
      expect(getPermissionModeForAgentMode('opencode', 'build')).toBeNull();
      expect(getPermissionModeForAgentMode('opencode', 'plan')).toBeNull();
    });
  });

  describe('null fallbacks', () => {
    it('unknown agent type → null', () => {
      expect(getPermissionModeForAgentMode('future-agent', 'some-mode')).toBeNull();
    });
    it('known agent, unknown mode → null', () => {
      expect(getPermissionModeForAgentMode('claude', 'some-future-mode')).toBeNull();
    });
  });
});
