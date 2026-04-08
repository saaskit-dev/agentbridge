/**
 * Unified worktree branch options (configured in one modal).
 *
 * Mode resolution in `createWorktree`:
 * - `auto` → create a random branch name (optional `startPoint`, or fall back to `existingBranch`)
 * - `existing` → check out the selected branch in a new worktree path
 * - `new` → create a named branch (uses `startPoint`, or falls back to `existingBranch`)
 */

export type WorktreeBranchMode = 'auto' | 'existing' | 'new';

export type WorktreeBranchBinding = {
  mode: WorktreeBranchMode;
  existingBranch: string;
  newBranchName: string;
  startPoint: string;
};

/**
 * Default: automatic random branch when creating the worktree.
 */
export function defaultWorktreeBranchBinding(): WorktreeBranchBinding {
  return { mode: 'auto', existingBranch: '', newBranchName: '', startPoint: '' };
}

/**
 * Validate the explicit UI mode so send-state matches user intent.
 */
export function isWorktreeBranchBindingValid(binding: WorktreeBranchBinding): boolean {
  const newBranchName = binding.newBranchName.trim();

  switch (binding.mode) {
    case 'auto':
      return newBranchName.length === 0;
    case 'existing':
      return binding.existingBranch.trim().length > 0 && newBranchName.length === 0;
    case 'new':
      return newBranchName.length > 0;
    default:
      return false;
  }
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
      return { mode: 'existing', existingBranch: o.branch, newBranchName: '', startPoint: '' };
    }
    if (o.kind === 'new') {
      return {
        mode: 'new',
        existingBranch: '',
        newBranchName: typeof o.branchName === 'string' ? o.branchName : '',
        startPoint: typeof o.startPoint === 'string' ? o.startPoint : '',
      };
    }
  }

  if (
    typeof o.mode === 'string' ||
    typeof o.existingBranch === 'string' ||
    typeof o.newBranchName === 'string' ||
    typeof o.startPoint === 'string'
  ) {
    const existingBranch = typeof o.existingBranch === 'string' ? o.existingBranch : '';
    const newBranchName = typeof o.newBranchName === 'string' ? o.newBranchName : '';
    const startPoint = typeof o.startPoint === 'string' ? o.startPoint : '';
    const parsedMode: WorktreeBranchMode =
      o.mode === 'existing' || o.mode === 'new' || o.mode === 'auto'
        ? o.mode
        : existingBranch.trim()
          ? 'existing'
          : newBranchName.trim()
            ? 'new'
            : 'auto';

    return {
      mode: parsedMode,
      existingBranch,
      newBranchName,
      startPoint,
    };
  }

  return defaultWorktreeBranchBinding();
}
