import { describe, expect, it } from 'vitest';
import { mergeQueuedMessagesForPromotion, removePromotedQueuedMessages } from './syncQueue';
import type { QueuedMessage } from './storageTypes';

function createQueuedMessage(
  id: string,
  createdAt: number,
  overrides: Partial<QueuedMessage> = {}
): QueuedMessage {
  return {
    id,
    text: id,
    createdAt,
    updatedAt: createdAt,
    permissionMode: 'accept-edits',
    model: null,
    fallbackModel: null,
    ...overrides,
  };
}

describe('mergeQueuedMessagesForPromotion', () => {
  it('merges queued messages into one promoted message stamped with promotion time', () => {
    const queuedMessages = [
      createQueuedMessage('queued-1', 1_100),
      createQueuedMessage('queued-2', 1_200, {
        text: 'second',
        attachments: [{ id: 'att-1', mimeType: 'image/jpeg' }],
        permissionMode: 'yolo',
      }),
    ];

    const merged = mergeQueuedMessagesForPromotion(queuedMessages, 5_000);

    expect(merged).toEqual({
      id: 'queued-2',
      text: 'queued-1\n\nsecond',
      promotedAt: 5_000,
      permissionMode: 'yolo',
      model: null,
      fallbackModel: null,
      attachments: [{ id: 'att-1', mimeType: 'image/jpeg' }],
      sourceQueuedMessageIds: ['queued-1', 'queued-2'],
    });
    expect(merged?.promotedAt).toBeGreaterThan(queuedMessages[0]!.createdAt);
  });
});

describe('removePromotedQueuedMessages', () => {
  it('removes only the promoted snapshot and preserves newer queued messages', () => {
    const currentQueuedMessages = [
      createQueuedMessage('queued-old', 1_100),
      createQueuedMessage('queued-new', 1_200),
    ];

    const remaining = removePromotedQueuedMessages(currentQueuedMessages, ['queued-old']);

    expect(remaining).toEqual([currentQueuedMessages[1]]);
  });

  it('is a no-op when there are no promoted ids', () => {
    const currentQueuedMessages = [createQueuedMessage('queued-only', 1_100)];
    expect(removePromotedQueuedMessages(currentQueuedMessages, [])).toEqual(currentQueuedMessages);
  });
});
