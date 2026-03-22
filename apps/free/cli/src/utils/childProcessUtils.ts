/**
 * Utilities for querying child process info via pgrep/ps.
 * Used by AgentSession (PID detection after backend.start) and
 * the daemon heartbeat (memory metrics collection).
 */

import { execFile } from 'node:child_process';

/** Return PIDs of direct children of the given parent PID. */
export function getChildPids(parentPid: number): Promise<number[]> {
  return new Promise(resolve => {
    execFile('pgrep', ['-P', String(parentPid)], { timeout: 3000 }, (err, stdout) => {
      if (err || !stdout.trim()) {
        resolve([]);
        return;
      }
      resolve(
        stdout
          .trim()
          .split('\n')
          .filter(Boolean)
          .map(Number)
          .filter(n => !isNaN(n))
      );
    });
  });
}

export interface ChildProcStats {
  pid: number;
  rssKB: number;
  sessionId?: string;
}

/**
 * Return RSS memory (kB) for each child PID, optionally annotated with sessionId
 * from the provided pid→sessionId map.
 */
export async function getChildProcStats(
  parentPid: number,
  pidToSessionId?: Map<number, string>
): Promise<ChildProcStats[]> {
  const pids = await getChildPids(parentPid);
  if (pids.length === 0) return [];

  return new Promise(resolve => {
    execFile(
      'ps',
      ['-o', 'pid=,rss=', '-p', pids.join(',')],
      { timeout: 5000 },
      (psErr, psStdout) => {
        if (psErr || !psStdout.trim()) {
          resolve([]);
          return;
        }
        const results: ChildProcStats[] = [];
        for (const line of psStdout.trim().split('\n')) {
          const parts = line.trim().split(/\s+/);
          const pid = parseInt(parts[0] ?? '', 10);
          const rssKB = parseInt(parts[1] ?? '', 10);
          if (!isNaN(pid) && !isNaN(rssKB)) {
            results.push({ pid, rssKB, sessionId: pidToSessionId?.get(pid) });
          }
        }
        resolve(results);
      }
    );
  });
}
