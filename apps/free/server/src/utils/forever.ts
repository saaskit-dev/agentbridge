import { AbortedExeption } from './aborted';
import { backoff } from './backoff';
import { keepAlive, shutdownSignal } from './shutdown';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';

const log = new Logger('utils/forever');

export function forever(name: string, callback: () => Promise<void>): void {
  void keepAlive(name, async () => {
    await backoff(async () => {
      while (!shutdownSignal.aborted) {
        try {
          await callback();
        } catch (error) {
          if (AbortedExeption.isAborted(error)) {
            break;
          } else {
            throw error;
          }
        }
      }
    });
  }).catch(error => {
    if (AbortedExeption.isAborted(error)) {
      return;
    }
    log.error('[forever] background task exited unexpectedly', {
      name,
      error: String(error),
    });
  });
}
