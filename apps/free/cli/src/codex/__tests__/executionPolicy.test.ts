import { describe, expect, it } from 'vitest';
import { resolveCodexExecutionPolicy } from '../executionPolicy';

describe('resolveCodexExecutionPolicy', () => {
  it('forces never + danger-full-access when sandbox is managed by Free', () => {
    const policy = resolveCodexExecutionPolicy('accept-edits', true);
    expect(policy).toEqual({ approvalPolicy: 'never', sandbox: 'danger-full-access' });
  });

  it('maps read-only to never + read-only', () => {
    const policy = resolveCodexExecutionPolicy('read-only', false);
    expect(policy).toEqual({ approvalPolicy: 'never', sandbox: 'read-only' });
  });

  it('maps accept-edits to on-request + workspace-write', () => {
    const policy = resolveCodexExecutionPolicy('accept-edits', false);
    expect(policy).toEqual({ approvalPolicy: 'on-request', sandbox: 'workspace-write' });
  });

  it('maps yolo to on-failure + danger-full-access', () => {
    const policy = resolveCodexExecutionPolicy('yolo', false);
    expect(policy).toEqual({ approvalPolicy: 'on-failure', sandbox: 'danger-full-access' });
  });
});
