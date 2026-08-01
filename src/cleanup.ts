import * as fs from 'node:fs';
import type { SessionAPI } from './api/session-api.js';
import { getConfigDir, readActiveState, removeActiveState } from './config.js';
import { logger } from './utils/logger.js';

/**
 * Pure Node liveness check — no subprocess, so no console window can flash
 * (works on Windows and POSIX; ESRCH = gone, EPERM = exists).
 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Close sessions whose creating window has exited: each window writes
 * ~/.config/coterm/active-<shellPID> with its sessionId; when that PID is no
 * longer alive the window is gone, so its session is closed and the marker
 * removed.
 */
export async function cleanupOrphanedSessions(api: SessionAPI): Promise<number> {
  let files: string[] = [];
  try {
    files = fs.readdirSync(getConfigDir()).filter((f) => /^active-\d+$/.test(f));
  } catch {
    return 0;
  }

  let closed = 0;
  for (const f of files) {
    const pid = Number(f.replace('active-', ''));
    if (!Number.isInteger(pid) || pid <= 0) continue;
    if (isProcessAlive(pid)) continue;

    const state = readActiveState(pid);
    if (state?.sessionId) {
      try {
        await api.destroySession(state.sessionId);
        closed++;
        logger.info({ sessionId: state.sessionId, pid }, 'Closed orphaned session (window exited)');
      } catch {
        // session already closed
      }
    }
    removeActiveState(pid);
  }
  return closed;
}
