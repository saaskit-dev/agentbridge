import { Logger, safeStringify } from '@saaskit-dev/agentbridge/telemetry';
import { isTauriDesktop } from '@/utils/tauri';

const logger = new Logger('app/utils/tauriDevtools');

let invokePromise: Promise<typeof import('@tauri-apps/api/core').invoke> | null = null;

async function getInvoke() {
  if (!invokePromise) {
    invokePromise = import('@tauri-apps/api/core').then(mod => mod.invoke);
  }
  return invokePromise;
}

export async function openTauriDevtools(): Promise<boolean> {
  if (!isTauriDesktop()) return false;

  try {
    const invoke = await getInvoke();
    await invoke('desktop_open_devtools');
    return true;
  } catch (error) {
    logger.warn('Failed to open Tauri devtools', { error: safeStringify(error) });
    return false;
  }
}
