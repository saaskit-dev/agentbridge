/**
 * Session operations for remote procedure calls
 * Provides strictly typed functions for all session-related RPC operations
 */

import { apiSocket } from './apiSocket';
import { getSessionTrace } from './appTraceStore';
import type { MachineMetadata } from './storageTypes';
import { safeStringify } from '@saaskit-dev/agentbridge/common';
import { Logger, toError } from '@saaskit-dev/agentbridge/telemetry';
const logger = new Logger('app/sync/ops');

// Callback for getting machine encryption, registered by sync.ts to avoid circular dependency
let _getMachineEncryption: ((machineId: string) => any) | null = null;

export function registerGetMachineEncryption(cb: (machineId: string) => any) {
  _getMachineEncryption = cb;
}

// Strict type definitions for all operations

// Permission operation types
interface SessionPermissionRequest {
  id: string;
  approved: boolean;
  reason?: string;
  mode?: 'read-only' | 'accept-edits' | 'yolo';
  allowTools?: string[];
  decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort';
}

// Mode change operation types
interface SessionModeChangeRequest {
  to: 'remote' | 'local';
}

// Bash operation types
interface SessionBashRequest {
  command: string;
  cwd?: string;
  timeout?: number;
}

interface SessionBashResponse {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  error?: string;
}

// Read file operation types
interface SessionReadFileRequest {
  path: string;
}

interface SessionReadFileResponse {
  success: boolean;
  content?: string; // base64 encoded
  error?: string;
}

// Write file operation types
interface SessionWriteFileRequest {
  path: string;
  content: string; // base64 encoded
  expectedHash?: string | null;
}

interface SessionWriteFileResponse {
  success: boolean;
  hash?: string;
  error?: string;
}

// List directory operation types
interface SessionListDirectoryRequest {
  path: string;
}

interface DirectoryEntry {
  name: string;
  type: 'file' | 'directory' | 'other';
  size?: number;
  modified?: number;
}

interface SessionListDirectoryResponse {
  success: boolean;
  entries?: DirectoryEntry[];
  error?: string;
}

// Directory tree operation types
interface SessionGetDirectoryTreeRequest {
  path: string;
  maxDepth: number;
}

interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  modified?: number;
  children?: TreeNode[];
}

interface SessionGetDirectoryTreeResponse {
  success: boolean;
  tree?: TreeNode;
  error?: string;
}

// Ripgrep operation types
interface SessionRipgrepRequest {
  args: string[];
  cwd?: string;
}

interface SessionRipgrepResponse {
  success: boolean;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  error?: string;
}

// Kill session operation types
interface SessionKillRequest {
  // No parameters needed
}

interface SessionKillResponse {
  success: boolean;
  message: string;
}

// Response types for spawn session
export type SpawnSessionResult =
  | { type: 'success'; sessionId: string }
  | { type: 'requestToApproveDirectoryCreation'; directory: string }
  | { type: 'error'; errorMessage: string };

// Options for spawning a session
export interface SpawnSessionOptions {
  machineId: string;
  directory: string;
  approvedNewDirectoryCreation?: boolean;
  token?: string;
  agent?: string;
  model?: string;
  mode?: string;
}

// Exported session operation functions

/**
 * Spawn a new remote session on a specific machine
 */
export async function machineSpawnNewSession(
  options: SpawnSessionOptions
): Promise<SpawnSessionResult> {
  const {
    machineId,
    directory,
    approvedNewDirectoryCreation = false,
    token,
    agent,
    model,
    mode,
  } = options;

  logger.info('[ops] machineSpawnNewSession', { machineId, directory, agent, model, mode });

  try {
    const result = await apiSocket.machineRPC<
      SpawnSessionResult,
      {
        type: 'spawn-in-directory';
        directory: string;
        approvedNewDirectoryCreation?: boolean;
        token?: string;
        agent?: string;
        model?: string;
        mode?: string;
      }
    >(machineId, 'spawn-free-session', {
      type: 'spawn-in-directory',
      directory,
      approvedNewDirectoryCreation,
      token,
      agent,
      model,
      mode,
    });
    logger.info('[ops] machineSpawnNewSession result', {
      machineId,
      directory,
      agent,
      model,
      mode,
      type: result.type,
      sessionId: result.type === 'success' ? result.sessionId : undefined,
    });
    return result;
  } catch (error) {
    // Handle RPC errors
    logger.error('[ops] machineSpawnNewSession failed', toError(error), { machineId, directory });
    return {
      type: 'error',
      errorMessage: safeStringify(error),
    };
  }
}

export async function machineListSupportedAgents(machineId: string): Promise<string[]> {
  logger.info('[ops] machineListSupportedAgents', { machineId });
  try {
    const result = await apiSocket.machineRPC<{ agents: string[] }, {}>(
      machineId,
      'list-supported-agents',
      {}
    );
    return Array.isArray(result.agents) ? result.agents : [];
  } catch (error) {
    logger.error('[ops] machineListSupportedAgents failed', toError(error), { machineId });
    return [];
  }
}

/**
 * Stop the daemon on a specific machine
 */
export async function machineStopDaemon(machineId: string): Promise<{ message: string }> {
  logger.info('[ops] machineStopDaemon', { machineId });
  const result = await apiSocket.machineRPC<{ message: string }, {}>(machineId, 'stop-daemon', {});
  return result;
}

/**
 * Execute a bash command on a specific machine
 */
export async function machineBash(
  machineId: string,
  command: string,
  cwd: string
): Promise<{
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}> {
  try {
    const result = await apiSocket.machineRPC<
      {
        success: boolean;
        stdout: string;
        stderr: string;
        exitCode: number;
      },
      {
        command: string;
        cwd: string;
      }
    >(machineId, 'bash', { command, cwd });
    return result;
  } catch (error) {
    return {
      success: false,
      stdout: '',
      stderr: safeStringify(error),
      exitCode: -1,
    };
  }
}

/**
 * Update machine metadata with optimistic concurrency control and automatic retry
 */
export async function machineUpdateMetadata(
  machineId: string,
  metadata: MachineMetadata,
  expectedVersion: number,
  maxRetries: number = 3
): Promise<{ version: number; metadata: string }> {
  let currentVersion = expectedVersion;
  let currentMetadata = { ...metadata };
  let retryCount = 0;

  const machineEncryption = _getMachineEncryption?.(machineId);
  if (!machineEncryption) {
    throw new Error(`Machine encryption not found for ${machineId}`);
  }

  while (retryCount < maxRetries) {
    const encryptedMetadata = await machineEncryption.encryptRaw(currentMetadata);

    const result = await apiSocket.emitWithAck<{
      result: 'success' | 'version-mismatch' | 'error';
      version?: number;
      metadata?: string;
      message?: string;
    }>('machine-update-metadata', {
      machineId,
      metadata: encryptedMetadata,
      expectedVersion: currentVersion,
      _trace: getSessionTrace(machineId),
    });

    if (result.result === 'success') {
      return {
        version: result.version!,
        metadata: result.metadata!,
      };
    } else if (result.result === 'version-mismatch') {
      // Get the latest version and metadata from the response
      currentVersion = result.version!;
      const latestMetadata = (await machineEncryption.decryptRaw(
        result.metadata!
      )) as MachineMetadata;

      // Merge: start from latest server state, then overlay all fields
      // the caller explicitly provided (non-undefined) to preserve user intent
      currentMetadata = { ...latestMetadata };
      for (const key of Object.keys(metadata) as Array<keyof typeof metadata>) {
        if (metadata[key] !== undefined) {
          (currentMetadata as any)[key] = metadata[key];
        }
      }

      retryCount++;
      logger.debug('[ops] machineUpdateMetadata version conflict, retrying', {
        machineId,
        retryCount,
        currentVersion,
      });

      // If we've exhausted retries, throw error
      if (retryCount >= maxRetries) {
        throw new Error(`Failed to update after ${maxRetries} retries due to version conflicts`);
      }

      // Otherwise, loop will retry with updated version and merged metadata
    } else {
      throw new Error(result.message || 'Failed to update machine metadata');
    }
  }

  throw new Error('Unexpected error in machineUpdateMetadata');
}

/**
 * Abort the current session operation
 */
export async function sessionAbort(sessionId: string): Promise<void> {
  logger.info('[ops] sessionAbort', { sessionId });
  await apiSocket.sessionRPC(sessionId, 'abort', {
    reason: `The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.`,
  });
}

export async function sessionSetModel(sessionId: string, modelId: string): Promise<void> {
  logger.info('[ops] sessionSetModel', { sessionId, modelId });
  await apiSocket.sessionRPC(sessionId, 'set-model', { modelId });
}

export async function sessionSetMode(sessionId: string, modeId: string): Promise<void> {
  logger.info('[ops] sessionSetMode', { sessionId, modeId });
  await apiSocket.sessionRPC(sessionId, 'set-mode', { modeId });
}

export async function sessionSetConfig(
  sessionId: string,
  optionId: string,
  value: string
): Promise<void> {
  logger.info('[ops] sessionSetConfig', { sessionId, optionId, value });
  await apiSocket.sessionRPC(sessionId, 'set-config', { optionId, value });
}

export async function sessionRunCommand(sessionId: string, commandId: string): Promise<void> {
  logger.info('[ops] sessionRunCommand', { sessionId, commandId });
  await apiSocket.sessionRPC(sessionId, 'run-command', { commandId });
}

/**
 * Allow a permission request
 */
export async function sessionAllow(
  sessionId: string,
  id: string,
  mode?: 'read-only' | 'accept-edits' | 'yolo',
  allowedTools?: string[],
  decision?: 'approved' | 'approved_for_session'
): Promise<void> {
  logger.debug('[ops] sessionAllow', { sessionId, id, decision });
  const request: SessionPermissionRequest = {
    id,
    approved: true,
    mode,
    allowTools: allowedTools,
    decision,
  };
  await apiSocket.sessionRPC(sessionId, 'permission', request);
}

/**
 * Deny a permission request
 */
export async function sessionDeny(
  sessionId: string,
  id: string,
  mode?: 'read-only' | 'accept-edits' | 'yolo',
  allowedTools?: string[],
  decision?: 'denied' | 'abort'
): Promise<void> {
  logger.debug('[ops] sessionDeny', { sessionId, id, decision });
  const request: SessionPermissionRequest = {
    id,
    approved: false,
    mode,
    allowTools: allowedTools,
    decision,
  };
  await apiSocket.sessionRPC(sessionId, 'permission', request);
}

/**
 * Request mode change for a session
 */
export async function sessionSwitch(sessionId: string, to: 'remote' | 'local'): Promise<boolean> {
  logger.info('[ops] sessionSwitch', { sessionId, to });
  const request: SessionModeChangeRequest = { to };
  const response = await apiSocket.sessionRPC<boolean, SessionModeChangeRequest>(
    sessionId,
    'switch',
    request
  );
  logger.info('[ops] sessionSwitch result', { sessionId, to, success: response });
  return response;
}

/**
 * Execute a bash command in the session
 */
export async function sessionBash(
  sessionId: string,
  request: SessionBashRequest
): Promise<SessionBashResponse> {
  logger.debug('[ops] sessionBash', { sessionId, command: request.command, cwd: request.cwd });
  try {
    const response = await apiSocket.sessionRPC<SessionBashResponse, SessionBashRequest>(
      sessionId,
      'bash',
      request
    );
    // Handle null response from RPC
    if (!response) {
      return {
        success: false,
        stdout: '',
        stderr: 'No response from session',
        exitCode: -1,
        error: 'No response from session',
      };
    }
    return response;
  } catch (error) {
    return {
      success: false,
      stdout: '',
      stderr: safeStringify(error),
      exitCode: -1,
      error: safeStringify(error),
    };
  }
}

/**
 * Read a file from the session
 */
export async function sessionReadFile(
  sessionId: string,
  path: string
): Promise<SessionReadFileResponse> {
  try {
    const request: SessionReadFileRequest = { path };
    const response = await apiSocket.sessionRPC<SessionReadFileResponse, SessionReadFileRequest>(
      sessionId,
      'readFile',
      request
    );
    if (!response) {
      return { success: false, error: 'No response from session' };
    }
    return response;
  } catch (error) {
    return {
      success: false,
      error: safeStringify(error),
    };
  }
}

/**
 * Write a file to the session
 */
export async function sessionWriteFile(
  sessionId: string,
  path: string,
  content: string,
  expectedHash?: string | null
): Promise<SessionWriteFileResponse> {
  try {
    const request: SessionWriteFileRequest = { path, content, expectedHash };
    const response = await apiSocket.sessionRPC<SessionWriteFileResponse, SessionWriteFileRequest>(
      sessionId,
      'writeFile',
      request
    );
    if (!response) {
      return { success: false, error: 'No response from session' };
    }
    return response;
  } catch (error) {
    return {
      success: false,
      error: safeStringify(error),
    };
  }
}

/**
 * List directory contents in the session
 */
export async function sessionListDirectory(
  sessionId: string,
  path: string
): Promise<SessionListDirectoryResponse> {
  try {
    const request: SessionListDirectoryRequest = { path };
    const response = await apiSocket.sessionRPC<
      SessionListDirectoryResponse,
      SessionListDirectoryRequest
    >(sessionId, 'listDirectory', request);
    if (!response) {
      return { success: false, error: 'No response from session' };
    }
    return response;
  } catch (error) {
    return {
      success: false,
      error: safeStringify(error),
    };
  }
}

/**
 * Get directory tree from the session
 */
export async function sessionGetDirectoryTree(
  sessionId: string,
  path: string,
  maxDepth: number
): Promise<SessionGetDirectoryTreeResponse> {
  try {
    const request: SessionGetDirectoryTreeRequest = { path, maxDepth };
    const response = await apiSocket.sessionRPC<
      SessionGetDirectoryTreeResponse,
      SessionGetDirectoryTreeRequest
    >(sessionId, 'getDirectoryTree', request);
    if (!response) {
      return { success: false, error: 'No response from session' };
    }
    return response;
  } catch (error) {
    return {
      success: false,
      error: safeStringify(error),
    };
  }
}

/**
 * Run ripgrep in the session
 */
export async function sessionRipgrep(
  sessionId: string,
  args: string[],
  cwd?: string
): Promise<SessionRipgrepResponse> {
  try {
    const request: SessionRipgrepRequest = { args, cwd };
    const response = await apiSocket.sessionRPC<SessionRipgrepResponse, SessionRipgrepRequest>(
      sessionId,
      'ripgrep',
      request
    );
    if (!response) {
      return { success: false, error: 'No response from session' };
    }
    return response;
  } catch (error) {
    return {
      success: false,
      error: safeStringify(error),
    };
  }
}

/**
 * Archive a session directly via server HTTP API.
 * Used when daemon RPC is unavailable (e.g. recovery failed sessions).
 */
export async function sessionArchiveViaServer(
  sessionId: string
): Promise<{ success: boolean; message?: string }> {
  logger.info('[ops] sessionArchiveViaServer', { sessionId });
  try {
    const response = await apiSocket.request(`/v1/sessions/${sessionId}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return { success: false, message: `Server returned ${response.status}: ${text}` };
    }
    return { success: true };
  } catch (error) {
    return { success: false, message: safeStringify(error) };
  }
}

/**
 * Kill the session process immediately
 */
export async function sessionKill(sessionId: string): Promise<SessionKillResponse> {
  logger.info('[ops] sessionKill', { sessionId });
  try {
    const response = await apiSocket.sessionRPC<SessionKillResponse, {}>(
      sessionId,
      'killSession',
      {}
    );
    if (!response) {
      return { success: false, message: 'No response from session' };
    }
    return response;
  } catch (error) {
    return {
      success: false,
      message: safeStringify(error),
    };
  }
}

/**
 * Force-restart the agent process for a session.
 * Used as a last-resort recovery when the agent is stuck or unresponsive.
 */
export async function sessionRestart(
  sessionId: string
): Promise<{ success: boolean; message?: string }> {
  logger.info('[ops] sessionRestart', { sessionId });
  try {
    const response = await apiSocket.sessionRPC<{ success: boolean; message: string }, {}>(
      sessionId,
      'restartAgent',
      {}
    );
    if (!response) {
      return { success: false, message: 'No response from session' };
    }
    return response;
  } catch (error) {
    return { success: false, message: safeStringify(error) };
  }
}

/**
 * Permanently delete a session from the server
 * This will remove the session and all its associated data (messages, usage reports, access keys)
 * The session should be inactive/archived before deletion
 */
export async function sessionDelete(
  sessionId: string
): Promise<{ success: boolean; message?: string }> {
  logger.info('[ops] sessionDelete', { sessionId });
  try {
    const response = await apiSocket.request(`/v1/sessions/${sessionId}`, {
      method: 'DELETE',
    });

    if (response.ok) {
      const result = await response.json();
      logger.info('[ops] sessionDelete success', { sessionId });
      return { success: true };
    } else {
      const error = await response.text();
      return {
        success: false,
        message: error || 'Failed to delete session',
      };
    }
  } catch (error) {
    logger.error('[ops] sessionDelete failed', toError(error), { sessionId });
    return {
      success: false,
      message: safeStringify(error),
    };
  }
}

/**
 * List directory contents on a machine (no session required)
 */
export async function machineListDirectory(
  machineId: string,
  path: string
): Promise<SessionListDirectoryResponse> {
  try {
    const result = await apiSocket.machineRPC<
      SessionListDirectoryResponse,
      { path: string }
    >(machineId, 'listDirectory', { path });
    return result;
  } catch (error) {
    return {
      success: false,
      error: safeStringify(error),
    };
  }
}

// Export types for external use
export type {
  SessionBashRequest,
  SessionBashResponse,
  SessionReadFileResponse,
  SessionWriteFileResponse,
  SessionListDirectoryResponse,
  DirectoryEntry,
  SessionGetDirectoryTreeResponse,
  TreeNode,
  SessionRipgrepResponse,
  SessionKillResponse,
};
