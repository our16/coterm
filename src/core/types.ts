export type SessionState = 'created' | 'starting' | 'running' | 'active' | 'paused' | 'closed' | 'error';

export type PresenceState = 'idle' | 'human-typing' | 'ai-thinking' | 'ai-running' | 'waiting-prompt';

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
  | { type: 'session:aiAttached'; sessionId: string; agent?: string }
  | { type: 'session:aiDetached'; sessionId: string; agent?: string }
  | { type: 'session:interrupted'; sessionId: string; by: Requester }
  | { type: 'session:presence'; sessionId: string; presence: PresenceState }
  | { type: 'session:recorded'; sessionId: string; recording: boolean }
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
  distro?: string;
  container?: string;
}

export interface ResolvedConnector {
  shell: string;
  shellArgs: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export interface Connector {
  name: string;
  type: ConnectorConfig['type'];
  resolve(config: ConnectorConfig): ResolvedConnector;
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

export interface RecordedEvent {
  id: string;
  type: SessionEvent['type'];
  sessionId: string;
  timestamp: number;
  data: Record<string, unknown>;
}

export interface SessionSnapshot {
  id: string;
  name: string;
  shell: string;
  shellArgs: string[];
  cwd: string;
  cols: number;
  rows: number;
  env: Record<string, string>;
  createdAt: number;
  owner: Requester;
  state: SessionState;
  prompt: string | null;
  screenLines: ScreenLine[];
  intelligence: SessionIntelligenceState;
}