export type SessionState = 'created' | 'starting' | 'running' | 'active' | 'paused' | 'closed' | 'error';

export type Requester = 'human' | 'ai';

export interface SessionConfig {
  id: string;
  name: string;
  shell: string;
  shellArgs: string[];
  cwd: string;
  cols: number;
  rows: number;
  env: Record<string, string>;
}

export interface SessionInfo {
  id: string;
  name: string;
  state: SessionState;
  shell: string;
  cwd: string;
  createdAt: number;
  owner: Requester;
}

export type SessionEvent =
  | { type: 'session:output'; sessionId: string; data: string }
  | { type: 'session:promptDetected'; sessionId: string; prompt: string }
  | { type: 'session:commandComplete'; sessionId: string; exitCode: number }
  | { type: 'session:error'; sessionId: string; error: Error }
  | { type: 'session:closed'; sessionId: string }
  | { type: 'session:aiAttached'; sessionId: string }
  | { type: 'session:aiDetached'; sessionId: string }
  | { type: 'session:interrupted'; sessionId: string; by: Requester }
  | { type: 'inputArbiter:locked'; sessionId: string; by: Requester }
  | { type: 'inputArbiter:unlocked'; sessionId: string };

export interface ScreenLine {
  text: string;
  rawText: string;
  cursorRow: number;
  cursorCol: number;
  timestamp: number;
}

export interface PtyAdapter {
  spawn(shell: string, args: string[], cwd: string, env: Record<string, string>): Promise<void>;
  write(data: string): Promise<void>;
  resize(cols: number, rows: number): void;
  onOutput(callback: (data: string) => void): void;
  onExit(callback: (code: number) => void): void;
  destroy(): Promise<void>;
}

export interface ConnectorConfig {
  type: 'local' | 'ssh' | 'wsl' | 'docker' | 'kubernetes' | 'serial';
  shell?: string;
  shellArgs?: string[];
  cwd?: string;
  env?: Record<string, string>;
  host?: string;
  port?: number;
  user?: string;
  identity?: string;
}

export interface Connector {
  name: string;
  type: ConnectorConfig['type'];
  connect(config: ConnectorConfig): Promise<PtyAdapter>;
  disconnect(adapter: PtyAdapter): Promise<void>;
}

export interface CommandEntry {
  id: string;
  command: string;
  requester: Requester;
  priority: number;
  timestamp: number;
}

export interface PromptPattern {
  shell: string;
  pattern: RegExp;
}

export interface McpTool {
  name: string;
  description: string;
  parameters: Record<string, { type: string; description: string; required?: boolean }>;
}

export interface CommandRecord {
  id: string;
  command: string;
  requester: Requester;
  startedAt: number;
  durationMs?: number;
  exitCode?: number;
  error?: boolean;
  outputPreview?: string;
}

export interface SessionIntelligenceState {
  cwd: string;
  state: SessionState;
  fullScreenApp: boolean;
  toolchains: Record<string, string>;
  commands: CommandRecord[];
  currentCommand: CommandRecord | null;
  lastCommand: CommandRecord | undefined;
}