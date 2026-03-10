import type { CodexSessionConfig } from './types';

type CodexApprovalPolicy = NonNullable<CodexSessionConfig['approval-policy']>;
type CodexSandboxMode = NonNullable<CodexSessionConfig['sandbox']>;

export function resolveCodexExecutionPolicy(
  permissionMode: import('@/api/types').PermissionMode,
  sandboxManagedByFree: boolean
): { approvalPolicy: CodexApprovalPolicy; sandbox: CodexSandboxMode } {
  if (sandboxManagedByFree) {
    return { approvalPolicy: 'never', sandbox: 'danger-full-access' };
  }

  switch (permissionMode) {
    case 'read-only':
      return { approvalPolicy: 'never', sandbox: 'read-only' };
    case 'accept-edits':
      return { approvalPolicy: 'on-request', sandbox: 'workspace-write' };
    case 'yolo':
      return { approvalPolicy: 'on-failure', sandbox: 'danger-full-access' };
    default:
      return { approvalPolicy: 'on-request', sandbox: 'workspace-write' };
  }
}
