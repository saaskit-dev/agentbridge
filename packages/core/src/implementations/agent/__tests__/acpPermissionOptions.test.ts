import { describe, expect, it } from 'vitest';
import { selectPermissionOptionId } from '../acp.js';

describe('selectPermissionOptionId', () => {
  it('prefers allow_always for approved_for_session decisions', () => {
    const optionId = selectPermissionOptionId(
      [
        { optionId: 'allow-1', name: 'Allow once', kind: 'allow_once' },
        { optionId: 'allow-2', name: 'Allow for session', kind: 'allow_always' },
      ],
      'approved_for_session'
    );

    expect(optionId).toBe('allow-2');
  });

  it('falls back to allow_once for one-off approvals', () => {
    const optionId = selectPermissionOptionId(
      [
        { optionId: 'allow-1', name: 'Allow once', kind: 'allow_once' },
        { optionId: 'allow-2', name: 'Allow for session', kind: 'allow_always' },
      ],
      'approved'
    );

    expect(optionId).toBe('allow-1');
  });
});
