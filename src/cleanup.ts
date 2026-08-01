import * as fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import type { SessionAPI } from './api/session-api.js';
import { getConfigDir, readActiveState, removeActiveState } from './config.js';
import { isWindows } from './utils/platform.js';
import { logger } from './utils/logger.js';

export function isProcessAlive(pid: number): boolean {
  if (isWindows()) {
    // spawnSync + windowsHide runs tasklist directly (no cmd.exe wrapper),
    // so no console window flashes even in a hidden daemon.
    const r = spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH'], {
      windowsHide: true,
      stdio: 'pipe',
      encoding: 'utf8',
    });
    if (r.error || r.status !== 0) return false;
    return (r.stdout ?? '').includes(String(pid));
  }
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
