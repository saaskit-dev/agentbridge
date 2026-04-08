import type { Message } from './typesMessage';

/**
 * Sort messages newest-first with deterministic tie-breaking.
 *
 * `seq` is the strongest ordering signal when both messages have it.
 * `createdAt` remains the main fallback and also keeps mixed sourced messages sensible.
 * When timestamps collide, we still force a stable order to avoid list jitter.
 */
export function sortMessagesDesc(a: Message, b: Message): number {
  if (a.seq !== undefined && b.seq !== undefined && a.seq !== b.seq) {
    return b.seq - a.seq;
  }

  if (a.createdAt !== b.createdAt) {
    return b.createdAt - a.createdAt;
  }

  if (a.seq !== undefined || b.seq !== undefined) {
    const seqDiff = (b.seq ?? Number.NEGATIVE_INFINITY) - (a.seq ?? Number.NEGATIVE_INFINITY);
    if (seqDiff !== 0) {
      return seqDiff;
    }
  }

  if (a.id === b.id) {
    return 0;
  }

  return a.id < b.id ? 1 : -1;
}
