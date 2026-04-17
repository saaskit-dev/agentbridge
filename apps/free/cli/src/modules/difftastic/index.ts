/**
 * Low-level difftastic wrapper - just arguments in, string out
 */

import { spawn } from 'child_process';
import { platform, arch } from 'os';
import { join, resolve } from 'path';
import { projectPath } from '@/projectPath';
import { MAX_RPC_COMMAND_STDERR_CHARS, MAX_RPC_COMMAND_STDOUT_CHARS, capCapturedOutput } from '@/utils/transportSafety';

export interface DifftasticResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  stdoutTruncated?: boolean;
  stderrTruncated?: boolean;
}

export interface DifftasticOptions {
  cwd?: string;
}

/**
 * Get the platform-specific binary path
 */
function getBinaryPath(): string {
  const platformName = platform();
  const binaryName = platformName === 'win32' ? 'difft.exe' : 'difft';
  return resolve(join(projectPath(), 'tools', 'unpacked', binaryName));
}

/**
 * Run difftastic with the given arguments
 * @param args - Array of command line arguments to pass to difftastic
 * @param options - Options for difftastic execution
 * @returns Promise with exit code, stdout and stderr
 */
export function run(args: string[], options?: DifftasticOptions): Promise<DifftasticResult> {
  const binaryPath = getBinaryPath();

  return new Promise((resolve, reject) => {
    const child = spawn(binaryPath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: options?.cwd,
      env: {
        ...process.env,
        // Force color output when needed
        FORCE_COLOR: '1',
      },
    });

    let stdout = '';
    let stderr = '';
    let stdoutTruncated = false;
    let stderrTruncated = false;

    child.stdout.on('data', data => {
      const next = capCapturedOutput(stdout, data.toString(), MAX_RPC_COMMAND_STDOUT_CHARS);
      stdout = next.value;
      stdoutTruncated = stdoutTruncated || next.truncated;
    });

    child.stderr.on('data', data => {
      const next = capCapturedOutput(stderr, data.toString(), MAX_RPC_COMMAND_STDERR_CHARS);
      stderr = next.value;
      stderrTruncated = stderrTruncated || next.truncated;
    });

    child.on('close', code => {
      resolve({
        exitCode: code || 0,
        stdout,
        stderr,
        stdoutTruncated,
        stderrTruncated,
      });
    });

    child.on('error', err => {
      reject(err);
    });
  });
}
