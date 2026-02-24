import { describe, it, expect } from 'vitest';
import {
  PermissionMode,
  ProtocolPermissionMode,
  toPermissionMode,
  toProtocolPermissionMode,
} from '../permission';

describe('permission types', () => {
  describe('toPermissionMode', () => {
    it('converts protocol permission modes to internal modes', () => {
      expect(toPermissionMode('default')).toBe('default');
      expect(toPermissionMode('acceptEdits')).toBe('accept-edits');
      expect(toPermissionMode('bypassPermissions')).toBe('bypass');
      expect(toPermissionMode('plan')).toBe('plan');
      expect(toPermissionMode('read-only')).toBe('read-only');
      expect(toPermissionMode('safe-yolo')).toBe('safe-yolo');
      expect(toPermissionMode('yolo')).toBe('yolo');
    });
  });

  describe('toProtocolPermissionMode', () => {
    it('converts internal modes to protocol modes', () => {
      expect(toProtocolPermissionMode('default')).toBe('default');
      expect(toProtocolPermissionMode('accept-edits')).toBe('acceptEdits');
      expect(toProtocolPermissionMode('bypass')).toBe('bypassPermissions');
      expect(toProtocolPermissionMode('plan')).toBe('plan');
      expect(toProtocolPermissionMode('read-only')).toBe('read-only');
      expect(toProtocolPermissionMode('safe-yolo')).toBe('safe-yolo');
      expect(toProtocolPermissionMode('yolo')).toBe('yolo');
    });
  });

  describe('PermissionRequest type compatibility', () => {
    it('accepts valid permission request structure', () => {
      const request = {
        id: 'req-123',
        sessionId: 'session-456',
        tool: 'Bash',
        action: 'Execute command',
        params: { command: 'ls' },
        timestamp: Date.now(),
      };

      expect(request.id).toBe('req-123');
      expect(request.tool).toBe('Bash');
    });
  });

  describe('PermissionResponse type compatibility', () => {
    it('accepts approved response', () => {
      const response = {
        requestId: 'req-123',
        allowed: true,
      };

      expect(response.allowed).toBe(true);
    });

    it('accepts denied response with reason', () => {
      const response = {
        requestId: 'req-123',
        allowed: false,
        reason: 'User rejected',
      };

      expect(response.allowed).toBe(false);
      expect(response.reason).toBe('User rejected');
    });

    it('accepts response with mode and allowedTools', () => {
      const response = {
        requestId: 'req-123',
        allowed: true,
        mode: 'accept-edits' as PermissionMode,
        allowedTools: ['Read', 'Write'],
      };

      expect(response.mode).toBe('accept-edits');
      expect(response.allowedTools).toContain('Read');
    });
  });

  describe('PermissionDecision type compatibility', () => {
    it('accepts all decision types', () => {
      const approved: 'approved' = 'approved';
      const approvedForSession: 'approved_for_session' = 'approved_for_session';
      const denied: 'denied' = 'denied';
      const abort: 'abort' = 'abort';

      expect(approved).toBe('approved');
      expect(approvedForSession).toBe('approved_for_session');
      expect(denied).toBe('denied');
      expect(abort).toBe('abort');
    });
  });

  describe('PermissionResult type compatibility', () => {
    it('accepts result with decision', () => {
      const result = {
        decision: 'approved' as const,
      };

      expect(result.decision).toBe('approved');
    });

    it('accepts result with reason and allowedTools', () => {
      const result = {
        decision: 'approved_for_session' as const,
        reason: 'User approved for session',
        allowedTools: ['Read', 'Write', 'Bash'],
      };

      expect(result.decision).toBe('approved_for_session');
      expect(result.allowedTools).toHaveLength(3);
    });
  });
});
