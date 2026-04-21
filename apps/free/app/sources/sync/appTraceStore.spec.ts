import { describe, expect, it } from 'vitest';

import { shouldAdoptIncomingSessionTrace } from './appTraceStore';

describe('shouldAdoptIncomingSessionTrace', () => {
  it('adopts traces from new-message updates', () => {
    expect(shouldAdoptIncomingSessionTrace('new-message')).toBe(true);
  });

  it('rejects status-only and metadata updates', () => {
    expect(shouldAdoptIncomingSessionTrace('update-session')).toBe(false);
    expect(shouldAdoptIncomingSessionTrace('new-session')).toBe(false);
    expect(shouldAdoptIncomingSessionTrace('delete-session')).toBe(false);
  });
});
