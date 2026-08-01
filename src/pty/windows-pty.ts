import * as pty from 'node-pty';
import type { PtyAdapter } from './pty-adapter.js';
import { logger } from '../utils/logger.js';

export class WindowsPtyAdapter implements PtyAdapter {
  private process: pty.IPty | null = null;
  private outputCallbacks: Array<(data: string) => void> = [];
  private exitCallbacks: Array<(code: number) => void> = [];
  private cols: number = 120;
  private rows: number = 30;

  async spawn(shell: string, args: string[], cwd: string, env: Record<string, string>): Promise<void> {
    const mergedEnv = { ...process.env, ...env };

    logger.info({ shell, args, cwd }, 'Spawning PTY process');

    this.process = pty.spawn(shell, args, {
      name: 'xterm-256color',
      cols: this.cols,
      rows: this.rows,
      cwd,
      env: mergedEnv as Record<string, string>,
    });

    this.process.onData((data: string) => {
      for (const cb of this.outputCallbacks) {
        cb(data);
      }
    });

    this.process.onExit((event: { exitCode: number }) => {
      for (const cb of this.exitCallbacks) {
        cb(event.exitCode);
      }
    });
  }

  async write(data: string): Promise<void> {
    if (!this.process) {
      throw new Error('PTY process has not been spawned');
    }
    this.process.write(data);
  }

  resize(cols: number, rows: number): void {
    if (!this.process) {
      logger.warn('Cannot resize: PTY process is null');
      return;
    }
    this.cols = cols;
    this.rows = rows;
    this.process.resize(cols, rows);
  }

  onOutput(callback: (data: string) => void): void {
    this.outputCallbacks.push(callback);
  }

  onExit(callback: (code: number) => void): void {
    this.exitCallbacks.push(callback);
  }

  async destroy(): Promise<void> {
    if (this.process) {
      try {
        this.process.kill();
      } catch (err) {
        logger.error({ err }, 'Error killing PTY process');
      }
      this.process = null;
    }
    this.outputCallbacks = [];
    this.exitCallbacks = [];
  }
}