import { exec, ExecOptions } from 'child_process';
import { createHash } from 'crypto';
import { readFile, writeFile, readdir, stat } from 'fs/promises';
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
}

interface ReadFileResponse {
  success: boolean;
  content?: string; // base64 encoded
  error?: string;
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
  type: 'file' | 'directory' | 'other';
  size?: number;
  modified?: number; // timestamp
}

interface ListDirectoryResponse {
  success: boolean;
  entries?: DirectoryEntry[];
  error?: string;
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

/*
 * Spawn Session Options and Result
 * This rpc type is used by the daemon, all other RPCs here are for sessions
 */

export interface SpawnSessionOptions {
  machineId?: string;
  directory: string;
  sessionId?: string;
  startedBy?: 'cli' | 'daemon' | 'app';
  /** Session tag to use when creating/finding session. Enables test sessions to be shared with daemon. */
  sessionTag?: string;
  /** Claude Code session ID to resume (passed as --resume-session-id). Only applies to claude agent. */
  resumeAgentSessionId?: string;
  approvedNewDirectoryCreation?: boolean;
  agent?: 'claude' | 'claude-acp' | 'codex' | 'codex-acp' | 'gemini' | 'opencode';
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
      const buffer = await readFile(data.path);
      const content = buffer.toString('base64');
      return { success: true, content };
    } catch (error) {
      log.debug('Failed to read file', { path: data.path, error: safeStringify(error) });
      return {
        success: false,
        error: safeStringify(error),
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

      try {
        // If expectedHash is provided (not null), verify existing file
        if (data.expectedHash !== null && data.expectedHash !== undefined) {
          try {
            const existingBuffer = await readFile(data.path);
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
            await stat(data.path);
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
        await writeFile(data.path, buffer);

        // Calculate and return hash of written file
        const hash = createHash('sha256').update(buffer).digest('hex');

        return { success: true, hash };
      } catch (error) {
        log.debug('Failed to write file', { path: data.path, error: safeStringify(error) });
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
        const entries = await readdir(data.path, { withFileTypes: true });

        const directoryEntries: DirectoryEntry[] = await Promise.all(
          entries.map(async entry => {
            const fullPath = join(data.path, entry.name);
            let type: 'file' | 'directory' | 'other' = 'other';
            let size: number | undefined;
            let modified: number | undefined;

            if (entry.isDirectory()) {
              type = 'directory';
            } else if (entry.isFile()) {
              type = 'file';
            }

            try {
              const stats = await stat(fullPath);
              size = stats.size;
              modified = stats.mtime.getTime();
            } catch (error) {
              // Ignore stat errors for individual files
              log.debug('Failed to stat entry', { path: fullPath, error: safeStringify(error) });
            }

            return {
              name: entry.name,
              type,
              size,
              modified,
            };
          })
        );

        // Sort entries: directories first, then files, alphabetically
        directoryEntries.sort((a, b) => {
          if (a.type === 'directory' && b.type !== 'directory') return -1;
          if (a.type !== 'directory' && b.type === 'directory') return 1;
          return a.name.localeCompare(b.name);
        });

        return { success: true, entries: directoryEntries };
      } catch (error) {
        log.debug('Failed to list directory', { path: data.path, error: safeStringify(error) });
        return {
          success: false,
          error: safeStringify(error),
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
        const baseName = data.path === '/' ? '/' : data.path.split('/').pop() || data.path;

        // Build the tree starting from the requested path
        const tree = await buildTree(data.path, baseName, 0);

        if (!tree) {
          return { success: false, error: 'Failed to access the specified path' };
        }

        return { success: true, tree };
      } catch (error) {
        log.debug('Failed to get directory tree', { path: data.path, error: safeStringify(error) });
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
