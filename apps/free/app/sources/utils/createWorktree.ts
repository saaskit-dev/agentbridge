/**
 * Create a Git worktree according to unified branch binding.
 */

import { generateWorktreeName } from './generateWorktreeName';
import { getWorktreeStorageRoot, normalizeWorktreePath } from './worktreePaths';
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

async function resolveWorktreeHomeDir(
  machineId: string,
  basePath: string,
  homeDir?: string
): Promise<string | null> {
  if (homeDir?.trim()) {
    return normalizeWorktreePath(homeDir.trim());
  }

  const result = await machineBash(machineId, 'printf %s "$HOME"', basePath);
  if (!result.success || !result.stdout.trim()) {
    return null;
  }

  return normalizeWorktreePath(result.stdout.trim());
}

async function resolveRepoRoot(machineId: string, basePath: string): Promise<string | null> {
  const result = await machineBash(machineId, 'git rev-parse --show-toplevel', basePath);
  if (!result.success || !result.stdout.trim()) {
    return null;
  }

  return normalizeWorktreePath(result.stdout.trim());
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
  worktreeRootPath: string,
  buildCommand: (worktreeName: string, worktreePath: string) => string
): Promise<{ success: boolean; stderr: string; worktreePath: string; worktreeName: string }> {
  const baseWorktreeName = generateWorktreeName();
  let worktreeName = baseWorktreeName;
  let worktreePath = `${worktreeRootPath}/${worktreeName}`;
  let result = await machineBash(machineId, buildCommand(worktreeName, worktreePath), basePath);

  if (!result.success && result.stderr.includes('already exists')) {
    for (let i = 2; i <= 4; i++) {
      worktreeName = `${baseWorktreeName}-${i}`;
      worktreePath = `${worktreeRootPath}/${worktreeName}`;
      result = await machineBash(machineId, buildCommand(worktreeName, worktreePath), basePath);
      if (result.success) {
        return { success: true, stderr: '', worktreePath, worktreeName };
      }
      if (!result.stderr.includes('already exists')) {
        break;
      }
    }
  }

  return {
    success: result.success,
    stderr: result.stderr,
    worktreePath,
    worktreeName,
  };
}

/**
 * Create a new worktree with a generated branch name (optional start ref).
 */
async function createAutoNamedWorktree(
  machineId: string,
  basePath: string,
  worktreeRootPath: string,
  startPoint?: string
): Promise<{
  success: boolean;
  worktreePath: string;
  branchName: string;
  error?: string;
}> {
  const quotedRoot = bashSingleQuoted(worktreeRootPath);
  const outcome = await runWorktreeAddWithPathRetries(
    machineId,
    basePath,
    worktreeRootPath,
    (worktreeName, worktreePath) => {
      const quotedPath = bashSingleQuoted(worktreePath);
      const startSuffix = startPoint?.trim()
        ? ` ${bashSingleQuoted(startPoint.trim())}`
        : '';
      return `mkdir -p ${quotedRoot} && git worktree add -b ${bashSingleQuoted(worktreeName)} ${quotedPath}${startSuffix}`;
    }
  );

  if (outcome.success) {
    return {
      success: true,
      worktreePath: outcome.worktreePath,
      branchName: outcome.worktreeName,
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

/**
 * Create a worktree under `~/free-worktree/<project>/...` according to the branch binding.
 */
export async function createWorktree(
  machineId: string,
  basePath: string,
  homeDir: string | undefined,
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

  const repoRoot = await resolveRepoRoot(machineId, basePath);
  if (!repoRoot) {
    return {
      success: false,
      worktreePath: '',
      branchName: '',
      error: 'Could not resolve repository root',
    };
  }

  await machineBash(machineId, 'git worktree prune', repoRoot);

  const resolvedHomeDir = await resolveWorktreeHomeDir(machineId, repoRoot, homeDir);
  if (!resolvedHomeDir) {
    return {
      success: false,
      worktreePath: '',
      branchName: '',
      error: 'Could not resolve home directory',
    };
  }

  if (!isWorktreeBranchBindingValid(binding)) {
    return {
      success: false,
      worktreePath: '',
      branchName: '',
      error: 'Invalid branch binding',
    };
  }

  const worktreeRootPath = getWorktreeStorageRoot(repoRoot, resolvedHomeDir);
  const existing = binding.existingBranch.trim();
  const newName = binding.newBranchName.trim();
  const start = binding.startPoint.trim();

  if (binding.mode === 'existing') {
    const quotedRoot = bashSingleQuoted(worktreeRootPath);
    const outcome = await runWorktreeAddWithPathRetries(
      machineId,
      repoRoot,
      worktreeRootPath,
      (_worktreeName, worktreePath) =>
        `mkdir -p ${quotedRoot} && git worktree add ${bashSingleQuoted(worktreePath)} ${bashSingleQuoted(existing)}`
    );

    if (outcome.success) {
      return {
        success: true,
        worktreePath: outcome.worktreePath,
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

  if (binding.mode === 'new') {
    const startPoint = start || existing;
    const quotedRoot = bashSingleQuoted(worktreeRootPath);
    const outcome = await runWorktreeAddWithPathRetries(
      machineId,
      repoRoot,
      worktreeRootPath,
      (_worktreeName, worktreePath) => {
        const startSuffix = startPoint ? ` ${bashSingleQuoted(startPoint)}` : '';
        return `mkdir -p ${quotedRoot} && git worktree add -b ${bashSingleQuoted(newName)} ${bashSingleQuoted(worktreePath)}${startSuffix}`;
      }
    );

    if (outcome.success) {
      return {
        success: true,
        worktreePath: outcome.worktreePath,
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

  return createAutoNamedWorktree(
    machineId,
    repoRoot,
    worktreeRootPath,
    start || existing || undefined
  );
}
