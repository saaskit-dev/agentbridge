import { describe, it, expect } from 'vitest';
import type {
  SessionMetadata,
  AgentState,
  AgentPermissionRequest,
  CompletedPermissionRequest,
  SessionOptions,
  Session,
} from '../session';

describe('session types', () => {
  describe('SessionMetadata', () => {
    it('accepts valid session metadata', () => {
      const metadata: SessionMetadata = {
        path: '/home/user/project',
        host: 'MacBook-Pro',
        version: '1.0.0',
        name: 'My Session',
        os: 'darwin',
      };

      expect(metadata.path).toBe('/home/user/project');
      expect(metadata.host).toBe('MacBook-Pro');
    });

    it('accepts minimal metadata with required fields', () => {
      const metadata: SessionMetadata = {
        path: '/home/user/project',
        host: 'localhost',
      };

      expect(metadata.path).toBe('/home/user/project');
      expect(metadata.version).toBeUndefined();
    });

    it('accepts metadata with all optional fields', () => {
      const metadata: SessionMetadata = {
        path: '/home/user/project',
        host: 'server-01',
        version: '2.0.0',
        name: 'Development Session',
        os: 'linux',
        machineId: 'machine-123',
        claudeSessionId: 'claude-session-456',
        tools: ['Read', 'Write', 'Bash'],
        slashCommands: ['/commit', '/review'],
        flavor: 'claude',
      };

      expect(metadata.tools).toContain('Read');
      expect(metadata.slashCommands).toContain('/commit');
    });
  });

  describe('AgentPermissionRequest', () => {
    it('accepts valid permission request', () => {
      const request: AgentPermissionRequest = {
        id: 'req-123',
        tool: 'Bash',
        arguments: { command: 'ls -la' },
        createdAt: Date.now(),
      };

      expect(request.id).toBe('req-123');
      expect(request.tool).toBe('Bash');
    });
  });

  describe('CompletedPermissionRequest', () => {
    it('accepts completed request', () => {
      const completed: CompletedPermissionRequest = {
        id: 'req-123',
        allowed: true,
        reason: 'User approved',
        mode: 'accept-edits',
        allowedTools: ['Read', 'Write'],
      };

      expect(completed.allowed).toBe(true);
      expect(completed.mode).toBe('accept-edits');
    });
  });

  describe('AgentState', () => {
    it('accepts valid agent state', () => {
      const state: AgentState = {
        controlledByUser: false,
        requests: {
          'req-1': {
            id: 'req-1',
            tool: 'Bash',
            arguments: { command: 'pwd' },
            createdAt: Date.now(),
          },
        },
        completedRequests: {
          'req-0': {
            id: 'req-0',
            allowed: true,
          },
        },
      };

      expect(state.controlledByUser).toBe(false);
      expect(Object.keys(state.requests || {})).toHaveLength(1);
    });

    it('accepts empty agent state', () => {
      const state: AgentState = {};

      expect(state.controlledByUser).toBeUndefined();
    });
  });

  describe('SessionOptions', () => {
    it('accepts valid session options', () => {
      const options: SessionOptions = {
        workingDir: '/path/to/project',
        permissionMode: 'accept-edits',
        agent: 'claude',
        cliArgs: ['--verbose'],
        env: { NODE_ENV: 'development' },
      };

      expect(options.workingDir).toBe('/path/to/project');
      expect(options.permissionMode).toBe('accept-edits');
    });

    it('accepts minimal options with required fields', () => {
      const options: SessionOptions = {
        workingDir: '/home/user',
      };

      expect(options.agent).toBeUndefined();
    });
  });

  describe('Session', () => {
    it('accepts valid session structure', () => {
      const session: Session = {
        id: 'session-123',
        seq: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        active: true,
        activeAt: Date.now(),
        metadata: null,
        metadataVersion: 0,
        agentState: null,
        agentStateVersion: 0,
        thinking: false,
        thinkingAt: 0,
        presence: 'online',
      };

      expect(session.id).toBe('session-123');
      expect(session.active).toBe(true);
      expect(session.thinking).toBe(false);
    });

    it('accepts session with metadata and agent state', () => {
      const session: Session = {
        id: 'session-456',
        seq: 5,
        createdAt: Date.now() - 1000,
        updatedAt: Date.now(),
        active: true,
        activeAt: Date.now(),
        metadata: {
          path: '/home/user/project',
          host: 'MacBook-Pro',
          version: '1.0.0',
        },
        metadataVersion: 3,
        agentState: {
          controlledByUser: false,
          requests: {},
          completedRequests: {},
        },
        agentStateVersion: 2,
        thinking: true,
        thinkingAt: Date.now() - 500,
        presence: 'online',
      };

      expect(session.metadata?.path).toBe('/home/user/project');
      expect(session.metadataVersion).toBe(3);
      expect(session.thinking).toBe(true);
    });

    it('accepts session with offline presence', () => {
      const session: Session = {
        id: 'session-789',
        seq: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        active: false,
        activeAt: Date.now() - 3600000,
        metadata: null,
        metadataVersion: 0,
        agentState: null,
        agentStateVersion: 0,
        thinking: false,
        thinkingAt: 0,
        presence: Date.now() - 1800000, // Last seen 30 min ago
      };

      expect(session.active).toBe(false);
      expect(typeof session.presence).toBe('number');
    });
  });
});
