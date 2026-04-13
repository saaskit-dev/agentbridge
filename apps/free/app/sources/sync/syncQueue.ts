import type { QueuedAttachment, QueuedMessage } from './storageTypes';

export interface MergedQueuedMessageForPromotion {
  id: string;
  text: string;
  displayText?: string;
  promotedAt: number;
  permissionMode: QueuedMessage['permissionMode'];
  model: string | null;
  fallbackModel: string | null;
  attachments?: QueuedAttachment[];
  sourceQueuedMessageIds: string[];
}

export function mergeQueuedMessagesForPromotion(
  queuedMessages: QueuedMessage[],
  promotedAt: number = Date.now()
): MergedQueuedMessageForPromotion | null {
  if (queuedMessages.length === 0) {
    return null;
  }

  const lastMessage = queuedMessages[queuedMessages.length - 1]!;
  const text = queuedMessages
    .map(message => message.text.trim())
    .filter(Boolean)
    .join('\n\n');
  const attachments = queuedMessages.flatMap(message => message.attachments ?? []);

  return {
    id: lastMessage.id,
    text,
    promotedAt,
    permissionMode: lastMessage.permissionMode,
    model: lastMessage.model,
    fallbackModel: lastMessage.fallbackModel,
    ...(attachments.length > 0 ? { attachments } : {}),
    sourceQueuedMessageIds: queuedMessages.map(message => message.id),
  };
}

export function removePromotedQueuedMessages(
  currentQueuedMessages: QueuedMessage[],
  promotedQueuedMessageIds: string[]
): QueuedMessage[] {
  if (promotedQueuedMessageIds.length === 0) {
    return currentQueuedMessages;
  }
  const promotedIds = new Set(promotedQueuedMessageIds);
  return currentQueuedMessages.filter(message => !promotedIds.has(message.id));
}
