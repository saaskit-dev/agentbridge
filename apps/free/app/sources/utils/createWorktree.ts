/**
 * Create a Git worktree according to unified branch binding.
 */

import { generateWorktreeName } from './generateWorktreeName';
import { machineBash } from '@/sync/ops';
import {
  defaultWorktreeBranchBinding,
  isWorktreeBranchBindingValid,
  type WorktreeBranchBinding,
} from '@/utils/worktreeBranchBinding';

/**
 * Escape a string for safe use as a single-quoted shell argument.
 */
function bashSingleQuoted(arg: string): string {
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

/**
 * List local branch names (refs/heads) for the repo at `cwd` on the remote machine.
 */
export async function listLocalGitBranches(machineId: string, cwd: string): Promise<string[]> {
  const result = await machineBash(
    machineId,
    "git for-each-ref --format='%(refname:short)' refs/heads/",
    cwd
  );
  if (!result.success) {
    return [];
  }
  return result.stdout
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Attempt `git worktree add` up to a few times if the target path already exists.
 */
async function runWorktreeAddWithPathRetries(
  machineId: string,
  basePath: string,
  buildCommand: (relativeWorktreePath: string) => string
): Promise<{ success: boolean; stderr: string; relativePath: string }> {
  let dirName = generateWorktreeName();
  let relativePath = `.dev/worktree/${dirName}`;
  let result = await machineBash(machineId, buildCommand(relativePath), basePath);

  if (!result.success && result.stderr.includes('already exists')) {
    for (let i = 2; i <= 4; i++) {
      const newName = `${dirName}-${i}`;
      relativePath = `.dev/worktree/${newName}`;
      result = await machineBash(machineId, buildCommand(relativePath), basePath);
      if (result.success) {
        return { success: true, stderr: '', relativePath };
      }
      if (!result.stderr.includes('already exists')) {
        break;
      }
    }
  }

  return {
    success: result.success,
    stderr: result.stderr,
    relativePath,
  };
}

/**
 * Create a new worktree with a generated branch name (optional start ref).
 */
async function createAutoNamedWorktree(
  machineId: string,
  basePath: string,
  startPoint?: string
): Promise<{
  success: boolean;
  worktreePath: string;
  branchName: string;
  error?: string;
}> {
  const name = generateWorktreeName();
  const relativePath = `.dev/worktree/${name}`;
  const cmd = startPoint?.trim()
    ? `git worktree add -b ${bashSingleQuoted(name)} ${bashSingleQuoted(relativePath)} ${bashSingleQuoted(startPoint.trim())}`
    : `git worktree add -b ${bashSingleQuoted(name)} ${bashSingleQuoted(relativePath)}`;

  let result = await machineBash(machineId, cmd, basePath);

  if (!result.success && result.stderr.includes('already exists')) {
    for (let i = 2; i <= 4; i++) {
      const newName = `${name}-${i}`;
      const newRelativePath = `.dev/worktree/${newName}`;
      const retryCmd = startPoint?.trim()
        ? `git worktree add -b ${bashSingleQuoted(newName)} ${bashSingleQuoted(newRelativePath)} ${bashSingleQuoted(startPoint.trim())}`
        : `git worktree add -b ${bashSingleQuoted(newName)} ${bashSingleQuoted(newRelativePath)}`;
      result = await machineBash(machineId, retryCmd, basePath);

      if (result.success) {
        return {
          success: true,
          worktreePath: `${basePath}/${newRelativePath}`,
          branchName: newName,
          error: undefined,
        };
      }
    }
  }

  if (result.success) {
    return {
      success: true,
      worktreePath: `${basePath}/${relativePath}`,
      branchName: name,
      error: undefined,
    };
  }

  return {
    success: false,
    worktreePath: '',
    branchName: '',
    error: result.stderr || 'Failed to create worktree',
  };
}

/**
 * Create a worktree under `.dev/worktree/...` according to the branch binding.
 */
export async function createWorktree(
  machineId: string,
  basePath: string,
  binding: WorktreeBranchBinding = defaultWorktreeBranchBinding()
): Promise<{
  success: boolean;
  worktreePath: string;
  branchName: string;
  error?: string;
}> {
  const gitCheck = await machineBash(machineId, 'git rev-parse --git-dir', basePath);

  if (!gitCheck.success) {
    return {
      success: false,
      worktreePath: '',
      branchName: '',
      error: 'Not a Git repository',
    };
  }

  await machineBash(machineId, 'git worktree prune', basePath);

  if (!isWorktreeBranchBindingValid(binding)) {
    return {
      success: false,
      worktreePath: '',
      branchName: '',
      error: 'Invalid branch binding',
    };
  }

  const existing = binding.existingBranch.trim();
  const newName = binding.newBranchName.trim();
  const start = binding.startPoint.trim();

  if (existing) {
    const outcome = await runWorktreeAddWithPathRetries(
      machineId,
      basePath,
      relativePath =>
        `git worktree add ${bashSingleQuoted(relativePath)} ${bashSingleQuoted(existing)}`
    );

    if (outcome.success) {
      return {
        success: true,
        worktreePath: `${basePath}/${outcome.relativePath}`,
        branchName: existing,
        error: undefined,
      };
    }

    const usedMatch = outcome.stderr.match(/is already used by worktree at '([^']+)'/);
    const hint = usedMatch
      ? ` Branch '${existing}' is in use by worktree at ${usedMatch[1]}. Remove it first or pick a different branch.`
      : '';

    return {
      success: false,
      worktreePath: '',
      branchName: '',
      error: (outcome.stderr || 'Failed to create worktree') + hint,
    };
  }

  if (newName) {
    const outcome = await runWorktreeAddWithPathRetries(machineId, basePath, relativePath => {
      if (start) {
        return `git worktree add -b ${bashSingleQuoted(newName)} ${bashSingleQuoted(relativePath)} ${bashSingleQuoted(start)}`;
      }
      return `git worktree add -b ${bashSingleQuoted(newName)} ${bashSingleQuoted(relativePath)}`;
    });

    if (outcome.success) {
      return {
        success: true,
        worktreePath: `${basePath}/${outcome.relativePath}`,
        branchName: newName,
        error: undefined,
      };
    }

    return {
      success: false,
      worktreePath: '',
      branchName: '',
      error: outcome.stderr || 'Failed to create worktree',
    };
  }

  return createAutoNamedWorktree(machineId, basePath, start || undefined);
}
