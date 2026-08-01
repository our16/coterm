import type { PtyAdapter } from './pty-adapter.js';
import { isWindows } from '../utils/platform.js';
import { WindowsPtyAdapter } from './windows-pty.js';
import { PosixPtyAdapter } from './posix-pty.js';

export function createPtyAdapter(): PtyAdapter {
  if (isWindows()) {
    return new WindowsPtyAdapter();
  }
  return new PosixPtyAdapter();
}

export default createPtyAdapter;
