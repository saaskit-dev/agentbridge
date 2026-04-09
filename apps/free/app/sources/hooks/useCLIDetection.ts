import { useState, useEffect } from 'react';
import { machineBash } from '@/sync/ops';
import { safeStringify } from '@saaskit-dev/agentbridge/common';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';
const logger = new Logger('app/hooks/useCLIDetection');

interface CLIAvailability {
  claude: boolean | null;
  codex: boolean | null;
  gemini: boolean | null;
  opencode: boolean | null;
  cursor: boolean | null;
  isDetecting: boolean; // Explicit loading state
  timestamp: number; // When detection completed
  error?: string; // Detection error message (for debugging)
}

/**
 * Detects if agent CLIs are installed on a remote machine.
 *
 * Detection sources:
 * - `free` CLI for `claude`, `codex`, `gemini`, and `opencode`
 * - `cursor-agent` CLI for Cursor agent
 *
 * NON-BLOCKING: Detection runs asynchronously in useEffect. UI keeps agent choices visible
 * while detection is in progress, then updates when results arrive.
 *
 * Detection is automatic when machineId changes. Uses existing machineBash() RPC
 * to run `command -v` checks on the remote machine.
 *
 * CONSERVATIVE FALLBACK: If detection fails (network error, timeout, bash error),
 * sets all CLIs to null and timestamp to 0, hiding status from UI.
 * User discovers CLI availability when attempting to spawn.
 *
 * @param machineId - The machine to detect CLIs on (null = no detection)
 * @returns CLI availability status for supported agents
 *
 * @example
 * const cliAvailability = useCLIDetection(selectedMachineId);
 * if (cliAvailability.cursor === false) {
 *     // Show "Cursor agent not detected" warning
 * }
 */
export function useCLIDetection(machineId: string | null): CLIAvailability {
  const [availability, setAvailability] = useState<CLIAvailability>({
    claude: null,
    codex: null,
    gemini: null,
    opencode: null,
    cursor: null,
    isDetecting: false,
    timestamp: 0,
  });

  useEffect(() => {
    if (!machineId) {
      setAvailability({
        claude: null,
        codex: null,
        gemini: null,
        opencode: null,
        cursor: null,
        isDetecting: false,
        timestamp: 0,
      });
      return;
    }

    let cancelled = false;

    const detectCLIs = async () => {
      // Set detecting flag (non-blocking - UI stays responsive)
      setAvailability(prev => ({ ...prev, isDetecting: true }));
      logger.debug('[useCLIDetection] Starting detection for machineId:', machineId);

      try {
        const result = await machineBash(
          machineId,
          [
            'command -v free >/dev/null 2>&1 && echo "free:true" || echo "free:false"',
            'command -v cursor-agent >/dev/null 2>&1 && echo "cursor-agent:true" || echo "cursor-agent:false"',
          ].join('; '),
          '/'
        );

        if (cancelled) return;
        logger.debug('[useCLIDetection] Result:', {
          success: result.success,
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
        });

        if (result.success && result.exitCode === 0) {
          const output = result.stdout.trim();
          const freeAvailable = output.includes('free:true');
          const cursorAgentAvailable = output.includes('cursor-agent:true');
          logger.debug('[useCLIDetection] Parsed availability', {
            freeAvailable,
            cursorAgentAvailable,
          });

          setAvailability({
            claude: freeAvailable,
            codex: freeAvailable,
            gemini: freeAvailable,
            opencode: freeAvailable,
            cursor: cursorAgentAvailable,
            isDetecting: false,
            timestamp: Date.now(),
          });
        } else {
          // Detection command failed - CONSERVATIVE fallback (don't assume availability)
          logger.debug(
            '[useCLIDetection] Detection failed (success=false or exitCode!=0):',
            result
          );
          setAvailability({
            claude: null,
            codex: null,
            gemini: null,
            opencode: null,
            cursor: null,
            isDetecting: false,
            timestamp: 0,
            error: `Detection failed: ${result.stderr || 'Unknown error'}`,
          });
        }
      } catch (error) {
        if (cancelled) return;

        // Network/RPC error - CONSERVATIVE fallback (don't assume availability)
        logger.debug('[useCLIDetection] Network/RPC error:', error);
        setAvailability({
          claude: null,
          codex: null,
          gemini: null,
          opencode: null,
          cursor: null,
          isDetecting: false,
          timestamp: 0,
          error: safeStringify(error),
        });
      }
    };

    detectCLIs();

    // Cleanup: Cancel detection if component unmounts or machineId changes
    return () => {
      cancelled = true;
    };
  }, [machineId]);

  return availability;
}
