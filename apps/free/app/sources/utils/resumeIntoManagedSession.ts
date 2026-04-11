import { Modal } from '@/modal';
import { getAgentDisplayName, normalizeAgentFlavor } from '@/sync/agentFlavor';
import { machineSpawnNewSession } from '@/sync/ops';
import type { PermissionMode } from '@/sync/sessionCapabilities';
import { t } from '@/text';

interface ResumeIntoManagedSessionOptions {
  machineId: string;
  directory: string;
  agent: string | null | undefined;
  resumeAgentSessionId: string;
  navigateToSession: (sessionId: string) => void;
  targetSessionId?: string;
  model?: string;
  mode?: string;
  permissionMode?: PermissionMode;
  confirmTitle?: string;
}

export async function resumeIntoManagedSession(
  options: ResumeIntoManagedSessionOptions
): Promise<string | null> {
  const normalizedAgent = normalizeAgentFlavor(options.agent);
  const agentLabel = getAgentDisplayName(normalizedAgent);

  const confirmed = await Modal.confirm(
    options.confirmTitle ?? t('machineImport.continueTitle'),
    t('machineImport.continueBody', { agent: agentLabel }),
    {
      cancelText: t('common.cancel'),
      confirmText: t('machineImport.continueHere'),
    }
  );
  if (!confirmed) {
    return null;
  }

  const spawn = async (directory: string, approvedNewDirectoryCreation = false) => {
    return machineSpawnNewSession({
      machineId: options.machineId,
      directory,
      sessionId: options.targetSessionId,
      restoreSession: Boolean(options.targetSessionId),
      agent: normalizedAgent,
      model: options.model,
      mode: options.mode,
      permissionMode: options.permissionMode,
      resumeAgentSessionId: options.resumeAgentSessionId,
      approvedNewDirectoryCreation,
      requireResumeSuccess: true,
      returnStructuredErrors: true,
    });
  };

  const showResumeError = (message?: string, isResumeFailure = true) => {
    Modal.alert(
      isResumeFailure ? t('machineImport.resumeFailedTitle') : t('common.error'),
      message ?? t('machineImport.resumeFailedBody', { agent: agentLabel })
    );
  };

  const result = await spawn(options.directory);
  if (result.type === 'success') {
    options.navigateToSession(result.sessionId);
    return result.sessionId;
  }

  if (result.type === 'requestToApproveDirectoryCreation') {
    const approved = await Modal.confirm(
      t('machineImport.directoryMissingTitle'),
      t('machineImport.directoryMissingBody', { directory: result.directory }),
      { cancelText: t('common.cancel'), confirmText: t('common.create') }
    );
    if (!approved) {
      return null;
    }

    const retried = await spawn(result.directory, true);
    if (retried.type === 'success') {
      options.navigateToSession(retried.sessionId);
      return retried.sessionId;
    }
    if (retried.type === 'error') {
      showResumeError(
        retried.errorCode === 'resume_failed' ? undefined : retried.errorMessage,
        retried.errorCode === 'resume_failed'
      );
    }
    return null;
  }

  showResumeError(
    result.errorCode === 'resume_failed' ? undefined : result.errorMessage,
    result.errorCode === 'resume_failed'
  );
  return null;
}
