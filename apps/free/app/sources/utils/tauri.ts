import { safeStringify } from '@saaskit-dev/agentbridge/telemetry';
import { Platform } from 'react-native';

type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export interface DesktopCLIStatus {
  installed: boolean;
  path: string | null;
  version: string | null;
  hasCredentials: boolean;
  daemonStateExists: boolean;
  daemonRunning: boolean;
  curlPath: string | null;
  bashPath: string | null;
  gitPath: string | null;
  nodePath: string | null;
  nodeVersion: string | null;
  brewPath: string | null;
  installIssues: Array<{
    code: string;
    message: string;
    canAutoFix: boolean;
    suggestedAction: string | null;
  }>;
  canAutoRepair: boolean;
}

export interface DesktopLogPaths {
  appTelemetryLogDir: string;
  appTelemetryLogPath: string;
  tauriLogDir: string;
  tauriLogPath: string;
}

let invokePromise: Promise<TauriInvoke> | null = null;

export function isTauriDesktop(): boolean {
  return (
    Platform.OS === 'web' &&
    typeof window !== 'undefined' &&
    (window as any).__TAURI_INTERNALS__ !== undefined
  );
}

export async function getTauriInvoke(): Promise<TauriInvoke> {
  if (!invokePromise) {
    invokePromise = import('@tauri-apps/api/core').then(mod => mod.invoke);
  }
  return invokePromise;
}

export async function isTauriUpdaterEnabled(): Promise<boolean> {
  if (!isTauriDesktop()) {
    return false;
  }

  try {
    const invoke = await getTauriInvoke();
    return await invoke<boolean>('desktop_is_updater_enabled');
  } catch {
    return false;
  }
}

export async function getDesktopCLIStatus(): Promise<DesktopCLIStatus> {
  if (!isTauriDesktop()) {
    throw new Error('Desktop CLI status is only available in Tauri desktop');
  }

  const invoke = await getTauriInvoke();
  return await invoke<DesktopCLIStatus>('desktop_get_cli_status');
}

export async function installDesktopCLI(): Promise<DesktopCLIStatus> {
  if (!isTauriDesktop()) {
    throw new Error('Desktop CLI installation is only available in Tauri desktop');
  }

  const invoke = await getTauriInvoke();
  return await invoke<DesktopCLIStatus>('desktop_install_cli');
}

export async function repairDesktopCLIEnvironment(): Promise<DesktopCLIStatus> {
  if (!isTauriDesktop()) {
    throw new Error('Desktop CLI repair is only available in Tauri desktop');
  }

  const invoke = await getTauriInvoke();
  return await invoke<DesktopCLIStatus>('desktop_repair_cli_environment');
}

export async function bootstrapDesktopCLIAuth(input: {
  token: string;
  secret: string;
}): Promise<DesktopCLIStatus> {
  if (!isTauriDesktop()) {
    throw new Error('Desktop CLI bootstrap is only available in Tauri desktop');
  }

  const invoke = await getTauriInvoke();
  return await invoke<DesktopCLIStatus>('desktop_bootstrap_cli_auth', { payload: input });
}

export async function appendDesktopAppLogs(lines: string[]): Promise<void> {
  if (!isTauriDesktop() || lines.length === 0) {
    return;
  }

  const invoke = await getTauriInvoke();
  await invoke('desktop_append_app_logs', { payload: { lines } });
}

export async function getDesktopLogPaths(): Promise<DesktopLogPaths> {
  if (!isTauriDesktop()) {
    throw new Error('Desktop log paths are only available in Tauri desktop');
  }

  const invoke = await getTauriInvoke();
  return await invoke<DesktopLogPaths>('desktop_get_log_paths');
}

export function getTauriErrorMessage(
  error: unknown,
  fallback = 'Unknown update error'
): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (typeof error === 'string' && error.trim()) {
    return error;
  }

  if (error && typeof error === 'object') {
    for (const key of ['message', 'error', 'details']) {
      const value = (error as Record<string, unknown>)[key];
      if (typeof value === 'string' && value.trim()) {
        return value;
      }
    }

    const serialized = safeStringify(error);
    if (serialized && serialized !== '{}' && serialized !== 'null') {
      return serialized;
    }
  }

  return fallback;
}
