import { describe, expect, it, vi } from 'vitest';
import { AcpPermissionHandler } from './AcpPermissionHandler';

function createMockSession() {
  let agentState: Record<string, unknown> = {
    requests: {},
    completedRequests: {},
  };

  return {
    session: {
      rpcHandlerManager: {
        registerHandler: vi.fn(),
      },
      updateAgentState: vi.fn(updater => {
        agentState = updater(agentState);
        return agentState;
      }),
    },
    getAgentState: () => agentState,
  };
}

describe('AcpPermissionHandler', () => {
  it('falls back to requestedPermissionMode when the current raw mode has no permission mapping', async () => {
    // Agent is in an unmapped native mode (e.g. "plan"). The handler must NOT escalate
    // to yolo — it must honour the user's original requestedPermissionMode ("read-only").
    const { session } = createMockSession();
    const handler = new AcpPermissionHandler(
      session as any,
      'opencode',
      () => 'plan',
      'read-only'
    );

    // read-only + dangerous tool (Bash) → must NOT auto-approve
    let resolved = false;
    const promise = handler.handleToolCall('tool-1', 'Bash', { command: 'pwd' });
    promise.then(() => {
      resolved = true;
    });

    await new Promise(r => setTimeout(r, 50));
    expect(resolved).toBe(false); // still pending, waiting for user approval
  });

  it('auto-approves read tools in read-only mode even when native mode is unmapped', async () => {
    const { session, getAgentState } = createMockSession();
    const handler = new AcpPermissionHandler(
      session as any,
      'opencode',
      () => 'plan',
      'read-only'
    );

    const result = await handler.handleToolCall('tool-1', 'read_file', { path: '/src/foo.ts' });

    expect(result.decision).toBe('approved');
    expect(getAgentState()).toMatchObject({
      completedRequests: {
        'tool-1': { tool: 'read_file', status: 'approved' },
      },
    });
  });
});
