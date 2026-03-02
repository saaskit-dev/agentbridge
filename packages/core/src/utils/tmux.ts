/**
 * Tmux utilities for terminal session management
 *
 * Provides utilities for managing tmux sessions, windows, and panes.
 * Only works on systems with tmux installed.
 *
 */

import { spawnSync } from 'node:child_process';

/**
 * Tmux control sequences
 */
export type TmuxControlSequence =
  | 'C-m' | 'C-c' | 'C-l' | 'C-u' | 'C-w' | 'C-a' | 'C-b' | 'C-d' | 'C-e' | 'C-f'
  | 'C-g' | 'C-h' | 'C-i' | 'C-j' | 'C-k' | 'C-n' | 'C-o' | 'C-p' | 'C-q' | 'C-r'
  | 'C-s' | 'C-t' | 'C-v' | 'C-x' | 'C-y' | 'C-z' | 'C-\\' | 'C-]' | 'C-[';

/**
 * Tmux environment info
 */
export interface TmuxEnvironment {
  session: string;
  window: string;
  pane: string;
  socketPath?: string;
}

/**
 * Tmux command result
 */
export interface TmuxCommandResult {
  returnCode: number;
  stdout: string;
  stderr: string;
  command: string[];
}

/**
 * Tmux session info
 */
export interface TmuxSessionInfo {
  targetSession: string;
  session: string;
  window: string;
  pane: string;
  socketPath?: string;
  tmuxActive: boolean;
  currentSession?: string;
}

/**
 * Check if tmux is available
 */
export function isTmuxAvailable(): boolean {
  try {
    const result = spawnSync('tmux', ['-V'], { encoding: 'utf-8' });
    return result.status === 0;
  } catch {
    return false;
  }
}

/**
 * Check if we're inside a tmux session
 */
export function isInsideTmux(): boolean {
  return !!process.env.TMUX;
}

/**
 * Get current tmux environment
 */
export function getTmuxEnvironment(): TmuxEnvironment | null {
  if (!isInsideTmux()) {
    return null;
  }

  return {
    session: getSessionName() || '',
    window: getWindowIndex() || '',
    pane: getPaneIndex() || '',
    socketPath: process.env.TMUX?.split(',')[0],
  };
}

/**
 * Get current session name
 */
export function getSessionName(): string | null {
  return getTmuxOption('session_name');
}

/**
 * Get current window index
 */
export function getWindowIndex(): string | null {
  return getTmuxOption('window_index');
}

/**
 * Get current pane index
 */
export function getPaneIndex(): string | null {
  return getTmuxOption('pane_index');
}

/**
 * Get a tmux option value
 */
function getTmuxOption(option: string): string | null {
  try {
    const args = ['display-message', '-p', '#{' + option + '}'];
    const result = execTmux(args);
    if (result.returnCode === 0) {
      return result.stdout.trim();
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Execute a tmux command synchronously
 */
export function execTmux(args: string[]): TmuxCommandResult {
  const result = spawnSync('tmux', args, {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe']
  });

  return {
    returnCode: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    command: ['tmux', ...args]
  };
}

/**
 * Create a new tmux session
 */
export function newSession(
  sessionName: string,
  options: {
    startDirectory?: string;
    windowName?: string;
    detached?: boolean;
  } = {}
): TmuxCommandResult {
  const args = ['new-session'];
  args.push('-s', sessionName);

  if (options.startDirectory) {
    args.push('-c', options.startDirectory);
  }
  if (options.windowName) {
    args.push('-n', options.windowName);
  }
  if (options.detached !== false) {
    args.push('-d');
  }

  return execTmux(args);
}

/**
 * Attach to a tmux session
 */
export function attachSession(sessionName: string): TmuxCommandResult {
  return execTmux(['attach-session', '-t', sessionName]);
}

/**
 * Kill a tmux session
 */
export function killSession(sessionName: string): TmuxCommandResult {
  return execTmux(['kill-session', '-t', sessionName]);
}

/**
 * List all tmux sessions
 */
export function listSessions(): string[] {
  const result = execTmux(['list-sessions', '-F', '#{session_name}']);
  if (result.returnCode === 0) {
    return result.stdout.trim().split('\n').filter(s => s.length > 0);
  }
  return [];
}

/**
 * Send keys to a tmux session/window/pane
 */
export function sendKeys(
  target: string,
  keys: string | TmuxControlSequence[],
  options: { enter?: boolean } = {}
): TmuxCommandResult {
  const args = ['send-keys', '-t', target];

  if (Array.isArray(keys)) {
    args.push(...keys);
  } else {
    args.push(keys);
  }

  if (options.enter !== false) {
    args.push('Enter');
  }

  return execTmux(args);
}

/**
 * Split window into panes
 */
export function splitWindow(
  target: string,
  options: {
    horizontal?: boolean;
    vertical?: boolean;
    percentage?: number;
    command?: string;
  } = {}
): TmuxCommandResult {
  const args = ['split-window', '-t', target];

  if (options.horizontal) {
    args.push('-h');
  }
  if (options.vertical) {
    args.push('-v');
  }
  if (options.percentage) {
    args.push('-p', String(options.percentage));
  }
  if (options.command) {
    args.push(options.command);
  }

  return execTmux(args);
}

/**
 * Select a pane
 */
export function selectPane(target: string, direction: 'L' | 'R' | 'U' | 'D'): TmuxCommandResult {
  return execTmux(['select-pane', '-t', target, '-' + direction]);
}

/**
 * Resize a pane
 */
export function resizePane(
  target: string,
  direction: 'L' | 'R' | 'U' | 'D',
  amount: number = 5
): TmuxCommandResult {
  return execTmux(['resize-pane', '-t', target, '-' + direction, '-x', String(amount)]);
}

/**
 * Set a tmux option
 */
export function setOption(
  target: string,
  option: string,
  value: string,
  isGlobal: boolean = false
): TmuxCommandResult {
  const args = ['set-option', '-t', target];
  if (isGlobal) {
    args.push('-g');
  }
  args.push(option, value);
  return execTmux(args);
}

/**
 * Rename a session
 */
export function renameSession(oldName: string, newName: string): TmuxCommandResult {
  return execTmux(['rename-session', '-t', oldName, newName]);
}

/**
 * Rename a window
 */
export function renameWindow(target: string, name: string): TmuxCommandResult {
  return execTmux(['rename-window', '-t', target, name]);
}

/**
 * Capture pane content
 */
export function capturePane(
  target: string,
  options: { startLine?: number; endLine?: number } = {}
): string {
  const args = ['capture-pane', '-t', target, '-p'];

  if (options.startLine !== undefined) {
    args.push('-S', String(options.startLine));
  }
  if (options.endLine !== undefined) {
    args.push('-E', String(options.endLine));
  }

  const result = execTmux(args);
  return result.returnCode === 0 ? result.stdout : '';
}

/**
 * Check if a session exists
 */
export function sessionExists(sessionName: string): boolean {
  const result = execTmux(['has-session', '-t', sessionName]);
  return result.returnCode === 0;
}
