import type { PtyAdapter } from '../../src/pty/pty-adapter.js';

export class MockPty implements PtyAdapter {
  public written: string[] = [];
  public resized: Array<{ cols: number; rows: number }> = [];
  public spawned = false;
  public destroyed = false;
  public spawnCalls: Array<{ shell: string; args: string[]; cwd: string; env: Record<string, string> }> = [];

  private outputCallbacks: Array<(data: string) => void> = [];
  private exitCallbacks: Array<(code: number) => void> = [];

  async spawn(shell: string, args: string[], cwd: string, env: Record<string, string>): Promise<void> {
    this.spawnCalls.push({ shell, args, cwd, env });
    this.spawned = true;
  }

  async write(data: string): Promise<void> {
    this.written.push(data);
  }

  resize(cols: number, rows: number): void {
    this.resized.push({ cols, rows });
  }

  onOutput(callback: (data: string) => void): void {
    this.outputCallbacks.push(callback);
  }

  onExit(callback: (code: number) => void): void {
    this.exitCallbacks.push(callback);
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
  }

  emitOutput(data: string): void {
    for (const cb of this.outputCallbacks) cb(data);
  }

  emitExit(code: number): void {
    for (const cb of this.exitCallbacks) cb(code);
  }
}

export default MockPty;
