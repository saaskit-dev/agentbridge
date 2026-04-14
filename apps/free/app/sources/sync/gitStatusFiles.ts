/**
 * Git status file-level functionality.
 * Keep this path lightweight because it drives interactive UI refreshes.
 */

import { Logger, toError } from '@saaskit-dev/agentbridge/telemetry';
import { sessionLogger } from '@/sync/appTraceStore';
import { parseStatusSummaryV2, getCurrentBranchV2 } from './git-parsers/parseStatusV2';
import { sessionBash } from './ops';
import { storage } from './storage';

const logger = new Logger('app/sync/gitStatusFiles');

export interface GitFileStatus {
  fileName: string;
  filePath: string;
  fullPath: string;
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked';
  isStaged: boolean;
  linesAdded: number;
  linesRemoved: number;
  oldPath?: string; // For renamed files
}

export interface GitStatusFiles {
  stagedFiles: GitFileStatus[];
  unstagedFiles: GitFileStatus[];
  branch: string | null;
  totalStaged: number;
  totalUnstaged: number;
}

/**
 * Fetch lightweight git status with file-level information.
 */
export async function getGitStatusFiles(sessionId: string): Promise<GitStatusFiles | null> {
  try {
    // Check if we have a session with valid metadata
    const session = storage.getState().sessions[sessionId];
    if (!session?.metadata?.path) {
      return null;
    }

    // Get git status in porcelain v2 format (includes branch info and repo check)
    // --untracked-files=all ensures we get individual files, not directories
    const statusResult = await sessionBash(sessionId, {
      command: 'git -c core.quotepath=false status --porcelain=v2 --branch --untracked-files=all',
      cwd: session.metadata.path,
      timeout: 10000,
    });

    if (!statusResult.success || statusResult.exitCode !== 0) {
      // Not a git repo or git command failed
      return null;
    }

    const statusOutput = statusResult.stdout;
    return parseGitStatusFilesV2(statusOutput);
  } catch (error) {
    sessionLogger(logger, sessionId).error('Error fetching git status files', toError(error));
    return null;
  }
}

/**
 * Parse git status v2 output into structured file data.
 */
function parseGitStatusFilesV2(statusOutput: string): GitStatusFiles {
  const statusSummary = parseStatusSummaryV2(statusOutput);
  const branchName = getCurrentBranchV2(statusSummary);

  const stagedFiles: GitFileStatus[] = [];
  const unstagedFiles: GitFileStatus[] = [];

  for (const file of statusSummary.files) {
    const parts = file.path.split('/');
    const fileNameOnly = parts[parts.length - 1] || file.path;
    const filePathOnly = parts.slice(0, -1).join('/');

    // Create file status for staged changes
    if (file.index !== ' ' && file.index !== '.' && file.index !== '?') {
      const status = getFileStatusV2(file.index);

      stagedFiles.push({
        fileName: fileNameOnly,
        filePath: filePathOnly,
        fullPath: file.path,
        status,
        isStaged: true,
        linesAdded: 0,
        linesRemoved: 0,
        oldPath: file.from,
      });
    }

    // Create file status for unstaged changes
    if (file.working_dir !== ' ' && file.working_dir !== '.') {
      const status = getFileStatusV2(file.working_dir);

      unstagedFiles.push({
        fileName: fileNameOnly,
        filePath: filePathOnly,
        fullPath: file.path,
        status,
        isStaged: false,
        linesAdded: 0,
        linesRemoved: 0,
        oldPath: file.from,
      });
    }
  }

  // Add untracked files to unstaged
  for (const untrackedPath of statusSummary.not_added) {
    // Handle both files and directories (directories have trailing slash)
    const isDirectory = untrackedPath.endsWith('/');
    const cleanPath = isDirectory ? untrackedPath.slice(0, -1) : untrackedPath;
    const parts = cleanPath.split('/');
    const fileNameOnly = parts[parts.length - 1] || cleanPath;
    const filePathOnly = parts.slice(0, -1).join('/');

    // Skip directory entries since we're using --untracked-files=all
    // This is a fallback in case git still reports directories
    if (isDirectory) {
      logger.warn(`Unexpected directory in untracked files: ${untrackedPath}`);
      continue;
    }

    unstagedFiles.push({
      fileName: fileNameOnly,
      filePath: filePathOnly,
      fullPath: cleanPath,
      status: 'untracked',
      isStaged: false,
      linesAdded: 0,
      linesRemoved: 0,
    });
  }

  return {
    stagedFiles,
    unstagedFiles,
    branch: branchName,
    totalStaged: stagedFiles.length,
    totalUnstaged: unstagedFiles.length,
  };
}

/**
 * Convert git status character to readable status (v2 format)
 */
function getFileStatusV2(statusChar: string): GitFileStatus['status'] {
  switch (statusChar) {
    case 'M':
      return 'modified';
    case 'A':
      return 'added';
    case 'D':
      return 'deleted';
    case 'R':
    case 'C':
      return 'renamed';
    case '?':
      return 'untracked';
    default:
      return 'modified';
  }
}
