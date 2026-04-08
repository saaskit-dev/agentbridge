import { describe, expect, it } from 'vitest';
import { sortMessagesDesc } from './messageSort';
import type { Message } from './typesMessage';

function createMessage(id: string, createdAt: number, seq?: number): Message {
  return {
    id,
    createdAt,
    updatedAt: createdAt,
    kind: 'user-text',
    text: id,
    displayText: id,
    seq,
  } as Message;
}

describe('sortMessagesDesc', () => {
  it('prefers higher seq when both messages have seq', () => {
    const olderCreated = createMessage('a', 1_000, 10);
    const newerCreated = createMessage('b', 2_000, 11);

    expect([olderCreated, newerCreated].sort(sortMessagesDesc).map(m => m.id)).toEqual(['b', 'a']);
  });

  it('falls back to createdAt when seq is missing', () => {
    const older = createMessage('a', 1_000);
    const newer = createMessage('b', 2_000);

    expect([older, newer].sort(sortMessagesDesc).map(m => m.id)).toEqual(['b', 'a']);
  });

  it('stays deterministic when createdAt matches but only one message has seq', () => {
    const withSeq = createMessage('a', 1_000, 4);
    const withoutSeq = createMessage('b', 1_000);

    expect([withoutSeq, withSeq].sort(sortMessagesDesc).map(m => m.id)).toEqual(['a', 'b']);
  });

  it('stays deterministic when createdAt and seq both match', () => {
    const alpha = createMessage('a', 1_000, 4);
    const beta = createMessage('b', 1_000, 4);

    expect([alpha, beta].sort(sortMessagesDesc).map(m => m.id)).toEqual(['b', 'a']);
  });
});
