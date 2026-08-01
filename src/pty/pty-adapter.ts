export interface PtyAdapter {
  spawn(shell: string, args: string[], cwd: string, env: Record<string, string>): Promise<void>;
  write(data: string): Promise<void>;
  resize(cols: number, rows: number): void;
  onOutput(callback: (data: string) => void): void;
  onExit(callback: (code: number) => void): void;
  destroy(): Promise<void>;
}