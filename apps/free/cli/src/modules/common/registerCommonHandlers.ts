import { exec, ExecOptions } from 'child_process';
import { createHash } from 'crypto';
import { readFile, writeFile, readdir, stat, lstat, realpath, readlink, open, rm, unlink } from 'fs/promises';
import { join } from 'path';
import { promisify } from 'util';
import { RpcHandlerManager } from '../../api/rpc/RpcHandlerManager';
import { validatePath } from './pathSecurity';
import { run as runDifftastic } from '@/modules/difftastic/index';
import { run as runRipgrep } from '@/modules/ripgrep/index';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';
import { safeStringify } from '@saaskit-dev/agentbridge';
const logger = new Logger('modules/common/registerCommonHandlers');

const execAsync = promisify(exec);

interface BashRequest {
  command: string;
  cwd?: string;
  timeout?: number; // timeout in milliseconds
}

interface BashResponse {
  success: boolean;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  error?: string;
}

interface ReadFileRequest {
  path: string;
  maxBytes?: number;
}

interface ReadFileResponse {
  success: boolean;
  content?: string; // base64 encoded
  error?: string;
  errorCode?: string;
  size?: number;
  truncated?: boolean;
  fileType?: 'file' | 'directory' | 'symlink' | 'other';
}

interface WriteFileRequest {
  path: string;
  content: string; // base64 encoded
  expectedHash?: string | null; // null for new files, hash for existing files
}

interface WriteFileResponse {
  success: boolean;
  hash?: string; // hash of written file
  error?: string;
}

interface ListDirectoryRequest {
  path: string;
}

interface DirectoryEntry {
  name: string;
  type: 'file' | 'directory' | 'symlink' | 'other';
  size?: number;
  modified?: number; // timestamp
  symlinkTarget?: string;
  symlinkTargetType?: 'file' | 'directory' | 'other' | 'missing';
  isBrokenSymlink?: boolean;
}

interface ListDirectoryResponse {
  success: boolean;
  entries?: DirectoryEntry[];
  error?: string;
  errorCode?: string;
}

interface GetDirectoryTreeRequest {
  path: string;
  maxDepth: number;
}

interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  modified?: number;
  children?: TreeNode[]; // Only present for directories
}

interface GetDirectoryTreeResponse {
  success: boolean;
  tree?: TreeNode;
  error?: string;
}

interface RipgrepRequest {
  args: string[];
  cwd?: string;
}

interface RipgrepResponse {
  success: boolean;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  error?: string;
}

interface DifftasticRequest {
  args: string[];
  cwd?: string;
}

interface DifftasticResponse {
  success: boolean;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  error?: string;
}

interface DeleteFileRequest {
  path: string;
  recursive?: boolean;
}

interface DeleteFileResponse {
  success: boolean;
  error?: string;
  errorCode?: string;
}

/*
 * Spawn Session Options and Result
 * This rpc type is used by the daemon, all other RPCs here are for sessions
 */

export interface SpawnSessionOptions {
  machineId?: string;
  directory: string;
  sessionId?: string;
  startedBy?: 'cli' | 'daemon' | 'app';
  /** Claude Code session ID to resume (passed as --resume-session-id). Only applies to claude agent. */
  resumeAgentSessionId?: string;
  approvedNewDirectoryCreation?: boolean;
  agent?: 'claude' | 'claude-native' | 'codex' | 'gemini' | 'opencode';
  model?: string;
  mode?: string;
  token?: string; // OAuth token for authentication
}

export type SpawnSessionResult =
  | { type: 'success'; sessionId: string }
  | { type: 'requestToApproveDirectoryCreation'; directory: string }
  | { type: 'error'; errorMessage: string };

/**
 * Register all RPC handlers with the session
 */
export function registerCommonHandlers(
  rpcHandlerManager: RpcHandlerManager,
  workingDirectory: string,
  machineId?: string
) {
  const log = {
    debug: (msg: string, data?: Record<string, unknown>) =>
      logger.debug(msg, machineId ? { machineId, ...data } : data),
  };

  // Shell command handler - executes commands in the default shell
  rpcHandlerManager.registerHandler<BashRequest, BashResponse>('bash', async data => {
    log.debug('Shell command request', { command: data.command });

    // Validate cwd if provided
    // Special case: "/" means "use shell's default cwd" (used by CLI detection)
    // Security: Still validate all other paths to prevent directory traversal
    if (data.cwd && data.cwd !== '/') {
      const validation = validatePath(data.cwd, workingDirectory);
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }
    }

    try {
      // Build options with shell enabled by default
      // Note: ExecOptions doesn't support boolean for shell, but exec() uses the default shell when shell is undefined
      // If cwd is "/", use undefined to let shell use its default (respects user's PATH)
      const options: ExecOptions = {
        cwd: data.cwd === '/' ? undefined : data.cwd,
        timeout: data.timeout || 30000, // Default 30 seconds timeout
      };

      log.debug('Shell command executing', { cwd: options.cwd, timeout: options.timeout });
      const { stdout, stderr } = await execAsync(data.command, options);
      log.debug('Shell command executed, processing result...');

      const result = {
        success: true,
        stdout: stdout ? stdout.toString() : '',
        stderr: stderr ? stderr.toString() : '',
        exitCode: 0,
      };
      log.debug('Shell command result', {
        success: true,
        exitCode: 0,
        stdoutLen: result.stdout.length,
        stderrLen: result.stderr.length,
      });
      return result;
    } catch (error) {
      const execError = error as NodeJS.ErrnoException & {
        stdout?: string;
        stderr?: string;
        code?: number | string;
        killed?: boolean;
      };

      // Check if the error was due to timeout
      if (execError.code === 'ETIMEDOUT' || execError.killed) {
        const result = {
          success: false,
          stdout: execError.stdout || '',
          stderr: execError.stderr || '',
          exitCode: typeof execError.code === 'number' ? execError.code : -1,
          error: 'Command timed out',
        };
        log.debug('Shell command timed out', {
          success: false,
          exitCode: result.exitCode,
          error: 'Command timed out',
        });
        return result;
      }

      // If exec fails, it includes stdout/stderr in the error
      const result = {
        success: false,
        stdout: execError.stdout ? execError.stdout.toString() : '',
        stderr: execError.stderr
          ? execError.stderr.toString()
          : execError.message || 'Command failed',
        exitCode: typeof execError.code === 'number' ? execError.code : 1,
        error: execError.message || 'Command failed',
      };
      log.debug('Shell command failed', {
        success: false,
        exitCode: result.exitCode,
        error: result.error,
        stdoutLen: result.stdout.length,
        stderrLen: result.stderr.length,
      });
      return result;
    }
  });

  // Read file handler - returns base64 encoded content
  rpcHandlerManager.registerHandler<ReadFileRequest, ReadFileResponse>('readFile', async data => {
    log.debug('Read file request', { path: data.path });

    // Validate path is within working directory
    const validation = validatePath(data.path, workingDirectory);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    try {
      const fileStats = await lstat(validation.resolvedPath);
      const isSymlink = fileStats.isSymbolicLink();

      if (fileStats.isDirectory()) {
        return {
          success: false,
          error: 'Path is a directory',
          errorCode: 'EISDIR',
          fileType: 'directory',
        };
      }

      if (!fileStats.isFile() && !isSymlink) {
        return {
          success: false,
          error: 'Path is not a regular file',
          errorCode: 'ESPECIAL',
          fileType: 'other',
        };
      }

      let resolvedStats = fileStats;
      if (isSymlink) {
        try {
          resolvedStats = await stat(validation.resolvedPath);
        } catch (error) {
          const nodeError = error as NodeJS.ErrnoException;
          return {
            success: false,
            error: safeStringify(error),
            errorCode: nodeError.code,
            fileType: 'symlink',
          };
        }
        if (resolvedStats.isDirectory()) {
          return {
            success: false,
            error: 'Path is a directory',
            errorCode: 'EISDIR',
            fileType: 'directory',
          };
        }
        if (!resolvedStats.isFile()) {
          return {
            success: false,
            error: 'Path is not a regular file',
            errorCode: 'ESPECIAL',
            fileType: 'other',
          };
        }
      }

      const totalSize = resolvedStats.size;
      const maxBytes =
        typeof data.maxBytes === 'number' && Number.isFinite(data.maxBytes) && data.maxBytes > 0
          ? Math.floor(data.maxBytes)
          : undefined;

      let buffer: Buffer;
      let truncated = false;
      if (maxBytes !== undefined && totalSize > maxBytes) {
        const fileHandle = await open(validation.resolvedPath, 'r');
        try {
          buffer = Buffer.allocUnsafe(maxBytes);
          const { bytesRead } = await fileHandle.read(buffer, 0, maxBytes, 0);
          buffer = buffer.subarray(0, bytesRead);
          truncated = bytesRead < totalSize;
        } finally {
          await fileHandle.close();
        }
      } else {
        buffer = await readFile(validation.resolvedPath);
      }

      const content = buffer.toString('base64');
      return {
        success: true,
        content,
        size: totalSize,
        truncated,
        fileType: isSymlink ? 'symlink' : 'file',
      };
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      log.debug('Failed to read file', { path: validation.resolvedPath, error: safeStringify(error) });
      return {
        success: false,
        error: safeStringify(error),
        errorCode: nodeError.code,
      };
    }
  });

  // Write file handler - with hash verification
  rpcHandlerManager.registerHandler<WriteFileRequest, WriteFileResponse>(
    'writeFile',
    async data => {
      log.debug('Write file request', { path: data.path });

      // Validate path is within working directory
      const validation = validatePath(data.path, workingDirectory);
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }

      const resolvedPath = validation.resolvedPath;

      try {
        // If expectedHash is provided (not null), verify existing file
        if (data.expectedHash !== null && data.expectedHash !== undefined) {
          try {
            const existingBuffer = await readFile(resolvedPath);
            const existingHash = createHash('sha256').update(existingBuffer).digest('hex');

            if (existingHash !== data.expectedHash) {
              return {
                success: false,
                error: `File hash mismatch. Expected: ${data.expectedHash}, Actual: ${existingHash}`,
              };
            }
          } catch (error) {
            const nodeError = error as NodeJS.ErrnoException;
            if (nodeError.code !== 'ENOENT') {
              throw error;
            }
            // File doesn't exist but hash was provided
            return {
              success: false,
              error: 'File does not exist but hash was provided',
            };
          }
        } else {
          // expectedHash is null - expecting new file
          try {
            await stat(resolvedPath);
            // File exists but we expected it to be new
            return {
              success: false,
              error: 'File already exists but was expected to be new',
            };
          } catch (error) {
            const nodeError = error as NodeJS.ErrnoException;
            if (nodeError.code !== 'ENOENT') {
              throw error;
            }
            // File doesn't exist - this is expected
          }
        }

        // Write the file
        const buffer = Buffer.from(data.content, 'base64');
        await writeFile(resolvedPath, buffer);

        // Calculate and return hash of written file
        const hash = createHash('sha256').update(buffer).digest('hex');

        return { success: true, hash };
      } catch (error) {
        log.debug('Failed to write file', { path: resolvedPath, error: safeStringify(error) });
        return {
          success: false,
          error: safeStringify(error),
        };
      }
    }
  );

  // List directory handler
  rpcHandlerManager.registerHandler<ListDirectoryRequest, ListDirectoryResponse>(
    'listDirectory',
    async data => {
      log.debug('List directory request', { path: data.path });

      // Validate path is within working directory
      const validation = validatePath(data.path, workingDirectory);
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }

      try {
        const entries = await readdir(validation.resolvedPath, { withFileTypes: true });

        const directoryEntries: DirectoryEntry[] = await Promise.all(
          entries.map(async entry => {
            const fullPath = join(validation.resolvedPath, entry.name);
            let type: 'file' | 'directory' | 'symlink' | 'other' = 'other';
            let size: number | undefined;
            let modified: number | undefined;
            let symlinkTarget: string | undefined;
            let symlinkTargetType: DirectoryEntry['symlinkTargetType'];
            let isBrokenSymlink = false;

            if (entry.isDirectory()) {
              type = 'directory';
            } else if (entry.isFile()) {
              type = 'file';
            } else if (entry.isSymbolicLink()) {
              type = 'symlink';
            }

            try {
              const stats = entry.isSymbolicLink() ? await lstat(fullPath) : await stat(fullPath);
              size = stats.size;
              modified = stats.mtime.getTime();
            } catch (error) {
              // Ignore stat errors for individual files
              log.debug('Failed to stat entry', { path: fullPath, error: safeStringify(error) });
            }

            if (entry.isSymbolicLink()) {
              try {
                symlinkTarget = await readlink(fullPath);
              } catch (error) {
                log.debug('Failed to read symlink target', {
                  path: fullPath,
                  error: safeStringify(error),
                });
              }

              try {
                const resolvedPath = await realpath(fullPath);
                const targetStats = await stat(fullPath);
                modified = targetStats.mtime.getTime();
                size = targetStats.size;
                if (targetStats.isDirectory()) {
                  symlinkTargetType = 'directory';
                } else if (targetStats.isFile()) {
                  symlinkTargetType = 'file';
                } else {
                  symlinkTargetType = 'other';
                }
                symlinkTarget = resolvedPath;
              } catch (error) {
                const nodeError = error as NodeJS.ErrnoException;
                isBrokenSymlink = nodeError.code === 'ENOENT';
                symlinkTargetType = isBrokenSymlink ? 'missing' : 'other';
                log.debug('Failed to resolve symlink target', {
                  path: fullPath,
                  error: safeStringify(error),
                });
              }
            }

            return {
              name: entry.name,
              type,
              size,
              modified,
              symlinkTarget,
              symlinkTargetType,
              isBrokenSymlink,
            };
          })
        );

        // Sort entries: directories first, then files, alphabetically
        directoryEntries.sort((a, b) => {
          const rank = (entry: DirectoryEntry) => {
            if (entry.type === 'directory') return 0;
            if (entry.type === 'symlink' && entry.symlinkTargetType === 'directory') return 1;
            if (entry.type === 'file') return 2;
            if (entry.type === 'symlink') return 3;
            return 4;
          };
          const diff = rank(a) - rank(b);
          if (diff !== 0) return diff;
          return a.name.localeCompare(b.name);
        });

        return { success: true, entries: directoryEntries };
      } catch (error) {
        const nodeError = error as NodeJS.ErrnoException;
        log.debug('Failed to list directory', { path: validation.resolvedPath, error: safeStringify(error) });
        return {
          success: false,
          error: safeStringify(error),
          errorCode: nodeError.code,
        };
      }
    }
  );

  // Get directory tree handler - recursive with depth control
  rpcHandlerManager.registerHandler<GetDirectoryTreeRequest, GetDirectoryTreeResponse>(
    'getDirectoryTree',
    async data => {
      log.debug('Get directory tree request', { path: data.path, maxDepth: data.maxDepth });

      // Validate path is within working directory
      const validation = validatePath(data.path, workingDirectory);
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }

      const resolvedRootPath = validation.resolvedPath;

      // Helper function to build tree recursively
      async function buildTree(
        path: string,
        name: string,
        currentDepth: number
      ): Promise<TreeNode | null> {
        try {
          const stats = await stat(path);

          // Base node information
          const node: TreeNode = {
            name,
            path,
            type: stats.isDirectory() ? 'directory' : 'file',
            size: stats.size,
            modified: stats.mtime.getTime(),
          };

          // If it's a directory and we haven't reached max depth, get children
          if (stats.isDirectory() && currentDepth < data.maxDepth) {
            const entries = await readdir(path, { withFileTypes: true });
            const children: TreeNode[] = [];

            // Process entries in parallel, filtering out symlinks
            await Promise.all(
              entries.map(async entry => {
                // Skip symbolic links completely
                if (entry.isSymbolicLink()) {
                  log.debug('Skipping symlink', { path: join(path, entry.name) });
                  return;
                }

                const childPath = join(path, entry.name);
                const childNode = await buildTree(childPath, entry.name, currentDepth + 1);
                if (childNode) {
                  children.push(childNode);
                }
              })
            );

            // Sort children: directories first, then files, alphabetically
            children.sort((a, b) => {
              if (a.type === 'directory' && b.type !== 'directory') return -1;
              if (a.type !== 'directory' && b.type === 'directory') return 1;
              return a.name.localeCompare(b.name);
            });

            node.children = children;
          }

          return node;
        } catch (error) {
          // Log error but continue traversal
          log.debug('Failed to process path', { path, error: safeStringify(error) });
          return null;
        }
      }

      try {
        // Validate maxDepth
        if (data.maxDepth < 0) {
          return { success: false, error: 'maxDepth must be non-negative' };
        }

        // Get the base name for the root node
        const baseName =
          resolvedRootPath === '/' ? '/' : resolvedRootPath.split('/').pop() || resolvedRootPath;

        // Build the tree starting from the requested path
        const tree = await buildTree(resolvedRootPath, baseName, 0);

        if (!tree) {
          return { success: false, error: 'Failed to access the specified path' };
        }

        return { success: true, tree };
      } catch (error) {
        log.debug('Failed to get directory tree', {
          path: resolvedRootPath,
          error: safeStringify(error),
        });
        return {
          success: false,
          error: safeStringify(error),
        };
      }
    }
  );

  // Ripgrep handler - raw interface to ripgrep
  rpcHandlerManager.registerHandler<RipgrepRequest, RipgrepResponse>('ripgrep', async data => {
    log.debug('Ripgrep request', { args: data.args, cwd: data.cwd });

    // Validate cwd if provided
    if (data.cwd) {
      const validation = validatePath(data.cwd, workingDirectory);
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }
    }

    try {
      const result = await runRipgrep(data.args, { cwd: data.cwd });
      return {
        success: true,
        exitCode: result.exitCode,
        stdout: result.stdout.toString(),
        stderr: result.stderr.toString(),
      };
    } catch (error) {
      log.debug('Failed to run ripgrep', { error: safeStringify(error) });
      return {
        success: false,
        error: safeStringify(error),
      };
    }
  });

  // Delete file/directory handler
  rpcHandlerManager.registerHandler<DeleteFileRequest, DeleteFileResponse>(
    'deleteFile',
    async data => {
      log.debug('Delete file request', { path: data.path, recursive: data.recursive });

      const validation = validatePath(data.path, workingDirectory);
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }

      try {
        const fileStats = await lstat(validation.resolvedPath);
        const isDirectory = fileStats.isDirectory();

        if (isDirectory && !data.recursive) {
          return { success: false, error: 'Path is a directory; set recursive=true to delete', errorCode: 'EISDIR' };
        }

        if (isDirectory) {
          await rm(validation.resolvedPath, { recursive: true, force: false });
        } else {
          await unlink(validation.resolvedPath);
        }

        return { success: true };
      } catch (error) {
        const nodeError = error as NodeJS.ErrnoException;
        log.debug('Failed to delete', { path: validation.resolvedPath, error: safeStringify(error) });
        return { success: false, error: safeStringify(error), errorCode: nodeError.code };
      }
    }
  );

  // Difftastic handler - raw interface to difftastic
  rpcHandlerManager.registerHandler<DifftasticRequest, DifftasticResponse>(
    'difftastic',
    async data => {
      log.debug('Difftastic request', { args: data.args, cwd: data.cwd });

      // Validate cwd if provided
      if (data.cwd) {
        const validation = validatePath(data.cwd, workingDirectory);
        if (!validation.valid) {
          return { success: false, error: validation.error };
        }
      }

      try {
        const result = await runDifftastic(data.args, { cwd: data.cwd });
        return {
          success: true,
          exitCode: result.exitCode,
          stdout: result.stdout.toString(),
          stderr: result.stderr.toString(),
        };
      } catch (error) {
        log.debug('Failed to run difftastic', { error: safeStringify(error) });
        return {
          success: false,
          error: safeStringify(error),
        };
      }
    }
  );
}
