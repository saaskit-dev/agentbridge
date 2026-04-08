import { describe, expect, it } from 'vitest';
import { compareCreatedDesc, compareUpdatedDesc } from './entitySort';

describe('compareUpdatedDesc', () => {
  it('sorts by updatedAt first', () => {
    const items = [
      { id: 'a', updatedAt: 1_000, createdAt: 500 },
      { id: 'b', updatedAt: 2_000, createdAt: 400 },
    ];

    expect(items.sort(compareUpdatedDesc).map(item => item.id)).toEqual(['b', 'a']);
  });

  it('uses createdAt and id as deterministic tie-breakers', () => {
    const items = [
      { id: 'a', updatedAt: 1_000, createdAt: 500 },
      { id: 'b', updatedAt: 1_000, createdAt: 500 },
      { id: 'c', updatedAt: 1_000, createdAt: 600 },
    ];

    expect(items.sort(compareUpdatedDesc).map(item => item.id)).toEqual(['c', 'b', 'a']);
  });
});

describe('compareCreatedDesc', () => {
  it('sorts by createdAt first', () => {
    const items = [
      { id: 'a', createdAt: 1_000, updatedAt: 5_000 },
      { id: 'b', createdAt: 2_000, updatedAt: 1_000 },
    ];

    expect(items.sort(compareCreatedDesc).map(item => item.id)).toEqual(['b', 'a']);
  });

  it('uses updatedAt, seq, and id as deterministic tie-breakers', () => {
    const items = [
      { id: 'a', createdAt: 1_000, updatedAt: 2_000, seq: 4 },
      { id: 'b', createdAt: 1_000, updatedAt: 2_000, seq: 4 },
      { id: 'c', createdAt: 1_000, updatedAt: 2_000, seq: 5 },
    ];

    expect(items.sort(compareCreatedDesc).map(item => item.id)).toEqual(['c', 'b', 'a']);
  });
});
