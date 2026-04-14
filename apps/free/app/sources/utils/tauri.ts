import { safeStringify } from '@saaskit-dev/agentbridge/telemetry';
import { Platform } from 'react-native';

type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

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
