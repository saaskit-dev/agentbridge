import { describe, expect, it } from 'vitest';
import { extractErrorMessage } from '@saaskit-dev/agentbridge/common';

describe('extractErrorMessage', () => {
  it('returns string values unchanged', () => {
    expect(extractErrorMessage('plain error')).toBe('plain error');
  });

  it('prefers an object error field', () => {
    expect(extractErrorMessage({ error: 'File has not been read yet' })).toBe(
      'File has not been read yet'
    );
  });

  it('falls back to message for structured errors', () => {
    expect(extractErrorMessage({ message: 'Permission denied', code: 'EACCES' })).toBe(
      'Permission denied'
    );
  });

  it('stringifies unknown objects instead of returning object tag', () => {
    expect(extractErrorMessage({ foo: 'bar' })).toBe('{"foo":"bar"}');
  });
});
