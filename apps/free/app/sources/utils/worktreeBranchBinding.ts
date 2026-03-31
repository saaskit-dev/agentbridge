/**
 * Unified worktree branch options (configured in one modal).
 *
 * Resolution order in `createWorktree`:
 * 1. `existingBranch` set → check out that branch in a new worktree path.
 * 2. Else `newBranchName` set → create that branch (optional `startPoint`).
 * 3. Else only `startPoint` set → auto branch name + start ref.
 * 4. Else → fully auto (random branch name, no start).
 */

export type WorktreeBranchBinding = {
  existingBranch: string;
  newBranchName: string;
  startPoint: string;
};

/**
 * Default: all empty → automatic random branch when creating the worktree.
 */
export function defaultWorktreeBranchBinding(): WorktreeBranchBinding {
  return { existingBranch: '', newBranchName: '', startPoint: '' };
}

/**
 * Always valid — empty binding means auto-create.
 */
export function isWorktreeBranchBindingValid(_binding: WorktreeBranchBinding): boolean {
  return true;
}

/**
 * Coerce persisted / legacy JSON into {@link WorktreeBranchBinding}.
 */
export function parseWorktreeBranchBinding(raw: unknown): WorktreeBranchBinding {
  if (!raw || typeof raw !== 'object') {
    return defaultWorktreeBranchBinding();
  }
  const o = raw as Record<string, unknown>;

  if (typeof o.kind === 'string') {
    if (o.kind === 'auto') {
      return defaultWorktreeBranchBinding();
    }
    if (o.kind === 'existing' && typeof o.branch === 'string') {
      return { existingBranch: o.branch, newBranchName: '', startPoint: '' };
    }
    if (o.kind === 'new') {
      return {
        existingBranch: '',
        newBranchName: typeof o.branchName === 'string' ? o.branchName : '',
        startPoint: typeof o.startPoint === 'string' ? o.startPoint : '',
      };
    }
  }

  if (
    typeof o.existingBranch === 'string' ||
    typeof o.newBranchName === 'string' ||
    typeof o.startPoint === 'string'
  ) {
    return {
      existingBranch: typeof o.existingBranch === 'string' ? o.existingBranch : '',
      newBranchName: typeof o.newBranchName === 'string' ? o.newBranchName : '',
      startPoint: typeof o.startPoint === 'string' ? o.startPoint : '',
    };
  }

  return defaultWorktreeBranchBinding();
}
