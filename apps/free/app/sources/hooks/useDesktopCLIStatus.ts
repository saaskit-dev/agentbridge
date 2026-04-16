import * as React from 'react';
import { AuthCredentials } from '@/auth/tokenStorage';
import { compareVersions, isVersionSupported, MINIMUM_CLI_VERSION } from '@/utils/versionUtils';
import {
  bootstrapDesktopCLIAuth,
  DesktopCLIStatus,
  getDesktopCLIStatus,
  installDesktopCLI,
  isTauriDesktop,
  repairDesktopCLIEnvironment,
} from '@/utils/tauri';
import { Logger, safeStringify } from '@saaskit-dev/agentbridge/telemetry';

const logger = new Logger('app/hooks/useDesktopCLIStatus');
const CLI_PACKAGE_NAME = '@saaskit-dev/free';

interface DesktopCLIRemoteVersion {
  latestVersion: string | null;
  latestVersionError: string | null;
}

export interface DesktopCLIState extends DesktopCLIStatus, DesktopCLIRemoteVersion {
  isChecking: boolean;
  isRepairing: boolean;
  isInstalling: boolean;
  isAuthorizing: boolean;
  error: string | null;
  needsInstall: boolean;
  needsAuth: boolean;
  needsUpdate: boolean;
  isSupported: boolean;
}

const defaultStatus: DesktopCLIStatus = {
  installed: false,
  path: null,
  version: null,
  hasCredentials: false,
  daemonStateExists: false,
  daemonRunning: false,
  curlPath: null,
  bashPath: null,
  gitPath: null,
  nodePath: null,
  nodeVersion: null,
  brewPath: null,
  installIssues: [],
  canAutoRepair: false,
};

async function fetchLatestCLIVersion(): Promise<DesktopCLIRemoteVersion> {
  try {
    const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(CLI_PACKAGE_NAME)}/latest`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = (await response.json()) as { version?: string };
    return {
      latestVersion: typeof data.version === 'string' ? data.version : null,
      latestVersionError: null,
    };
  } catch (error) {
    const message = safeStringify(error);
    logger.warn('Failed to fetch latest CLI version', { error: message });
    return {
      latestVersion: null,
      latestVersionError: message,
    };
  }
}

function buildState(
  status: DesktopCLIStatus,
  remote: DesktopCLIRemoteVersion,
  extra?: Partial<DesktopCLIState>
): DesktopCLIState {
  const isSupported = status.installed && isVersionSupported(status.version ?? undefined, MINIMUM_CLI_VERSION);
  const needsUpdate =
    status.installed &&
    !!status.version &&
    !!remote.latestVersion &&
    compareVersions(status.version, remote.latestVersion) < 0;

  return {
    ...status,
    ...remote,
    isChecking: false,
    isRepairing: false,
    isInstalling: false,
    isAuthorizing: false,
    error: null,
    needsInstall: !status.installed,
    needsAuth: status.installed && !status.hasCredentials,
    needsUpdate,
    isSupported,
    ...extra,
  };
}

export function useDesktopCLIStatus(credentials: AuthCredentials | null) {
  const [state, setState] = React.useState<DesktopCLIState>(() =>
    buildState(defaultStatus, { latestVersion: null, latestVersionError: null }, { isChecking: isTauriDesktop() })
  );

  const refresh = React.useCallback(async () => {
    if (!isTauriDesktop()) {
      return;
    }

    setState(prev => ({ ...prev, isChecking: true, error: null }));

    try {
      const [status, remote] = await Promise.all([getDesktopCLIStatus(), fetchLatestCLIVersion()]);
      setState(buildState(status, remote));
    } catch (error) {
      const message = safeStringify(error);
      logger.warn('Failed to refresh desktop CLI status', { error: message });
      setState(prev =>
        buildState(prev, { latestVersion: prev.latestVersion, latestVersionError: prev.latestVersionError }, {
          isChecking: false,
          error: message,
        })
      );
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const installOrUpdate = React.useCallback(async () => {
    if (!isTauriDesktop()) {
      return;
    }

    setState(prev => ({ ...prev, isInstalling: true, error: null }));
    try {
      let status = await getDesktopCLIStatus();
      if (status.installIssues.length > 0 && status.canAutoRepair) {
        setState(prev => ({ ...prev, isRepairing: true }));
        status = await repairDesktopCLIEnvironment();
      }

      if (status.installIssues.length > 0) {
        const unresolved = status.installIssues.map(issue => issue.message).join(' ');
        throw new Error(unresolved);
      }

      status = await installDesktopCLI();
      const remote = await fetchLatestCLIVersion();
      setState(buildState(status, remote));
    } catch (error) {
      const message = safeStringify(error);
      logger.warn('Failed to install desktop CLI', { error: message });
      setState(prev => ({ ...prev, isInstalling: false, isRepairing: false, error: message }));
    }
  }, []);

  const authorize = React.useCallback(async () => {
    if (!isTauriDesktop() || !credentials) {
      return;
    }

    setState(prev => ({ ...prev, isAuthorizing: true, error: null }));
    try {
      const status = await bootstrapDesktopCLIAuth({
        token: credentials.token,
        secret: credentials.secret,
      });
      const remote = await fetchLatestCLIVersion();
      setState(buildState(status, remote));
    } catch (error) {
      const message = safeStringify(error);
      logger.warn('Failed to bootstrap desktop CLI auth', { error: message });
      setState(prev => ({ ...prev, isAuthorizing: false, error: message }));
    }
  }, [credentials]);

  return {
    state,
    refresh,
    installOrUpdate,
    authorize,
  };
}
