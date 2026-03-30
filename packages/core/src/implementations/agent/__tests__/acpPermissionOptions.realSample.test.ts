import { describe, expect, it } from 'vitest';
import { selectPermissionOptionId } from '../acp.js';

const claudeAndCodexRealOptions = [
  { optionId: 'allow_always', name: 'Always Allow', kind: 'allow_always' },
  { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
  { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
] as const;

describe('selectPermissionOptionId with real ACP samples', () => {
  it('maps approved_for_session to the real allow_always option id', () => {
    expect(selectPermissionOptionId([...claudeAndCodexRealOptions], 'approved_for_session')).toBe(
      'allow_always'
    );
  });

  it('maps approved to the real allow_once option id even when optionId is not allow_once', () => {
    expect(selectPermissionOptionId([...claudeAndCodexRealOptions], 'approved')).toBe('allow');
  });
});
