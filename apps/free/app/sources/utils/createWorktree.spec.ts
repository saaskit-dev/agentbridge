import { describe, expect, it } from 'vitest';
import { getWorktreeStorageRoot } from './worktreePaths';

describe('createWorktree path helpers', () => {
  it('stores worktrees under the user home directory', () => {
    expect(getWorktreeStorageRoot('/Users/dev/agentbridge', '/Users/dev')).toBe(
      '/Users/dev/free-worktree/agentbridge'
    );
  });

  it('normalizes trailing separators before composing the worktree root', () => {
    expect(getWorktreeStorageRoot('/Users/dev/agentbridge/', '/Users/dev/')).toBe(
      '/Users/dev/free-worktree/agentbridge'
    );
  });
});
