/**
 * Low-level ripgrep wrapper - just arguments in, string out
 */

import { spawn } from 'child_process';
import { join, resolve } from 'path';
import { projectPath } from '@/projectPath';
import { MAX_RPC_COMMAND_STDERR_CHARS, MAX_RPC_COMMAND_STDOUT_CHARS, capCapturedOutput } from '@/utils/transportSafety';

export interface RipgrepResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  stdoutTruncated?: boolean;
  stderrTruncated?: boolean;
}

export interface RipgrepOptions {
  cwd?: string;
}

/**
 * Run ripgrep with the given arguments
 * @param args - Array of command line arguments to pass to ripgrep
 * @param options - Options for ripgrep execution
 * @returns Promise with exit code, stdout and stderr
 */
export function run(args: string[], options?: RipgrepOptions): Promise<RipgrepResult> {
  const RUNNER_PATH = resolve(join(projectPath(), 'scripts', 'ripgrep_launcher.cjs'));
  return new Promise((resolve, reject) => {
    const child = spawn('node', [RUNNER_PATH, JSON.stringify(args)], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: options?.cwd,
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
