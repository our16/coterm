import type { PtyAdapter, Requester, ScreenLine, SessionConfig, SessionEvent, SessionInfo } from '../core/types.js';
import { SessionManager } from '../core/session-manager.js';
import { eventBus } from '../core/event-bus.js';
import { uuid } from '../utils/uuid.js';
import { isWindows } from '../utils/platform.js';
import { WindowsPtyAdapter } from '../pty/windows-pty.js';

export interface SessionApiOptions {
  defaultShell?: string;
  defaultShellArgs?: string[];
  defaultCwd?: string;
  cols?: number;
  rows?: number;
  adapterFactory?: () => PtyAdapter;
  manager?: SessionManager;
}

export function detectDefaultShell(): string {
  const shell = process.env.SHELL;
  if (shell) return shell;
  if (isWindows()) {
    return process.env.COTERM_SHELL ?? 'powershell.exe';
  }
  return '/bin/bash';
}

export class SessionAPI {
  private options: Required<Pick<SessionApiOptions, 'defaultShell' | 'defaultShellArgs' | 'defaultCwd' | 'cols' | 'rows'>> & SessionApiOptions;
  private manager: SessionManager;

  constructor(options: SessionApiOptions = {}) {
    this.options = {
      defaultShell: options.defaultShell ?? detectDefaultShell(),
      defaultShellArgs: options.defaultShellArgs ?? [],
      defaultCwd: options.defaultCwd ?? process.cwd(),
      cols: options.cols ?? 120,
      rows: options.rows ?? 30,
      adapterFactory: options.adapterFactory,
    };
    this.manager = options.manager ?? new SessionManager();
  }

  getSessionManager(): SessionManager {
    return this.manager;
  }

  private createAdapter(): PtyAdapter {
    if (this.options.adapterFactory) {
      return this.options.adapterFactory();
    }
    return new WindowsPtyAdapter();
  }

  private requireSession(sessionId: string) {
    const session = this.manager.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }
    return session;
  }

  async createSession(config: Partial<SessionConfig> = {}): Promise<string> {
    const id = config.id ?? uuid();
    const fullConfig: SessionConfig = {
      id,
      name: config.name ?? id,
      shell: config.shell ?? this.options.defaultShell,
      shellArgs: config.shellArgs ?? this.options.defaultShellArgs,
      cwd: config.cwd ?? this.options.defaultCwd,
      cols: config.cols ?? this.options.cols,
      rows: config.rows ?? this.options.rows,
      env: config.env ?? {},
    };

    const session = this.manager.createSession(fullConfig);
    await session.start(this.createAdapter());
    return session.id;
  }

  getSession(id: string): SessionInfo {
    return this.requireSession(id).getInfo();
  }

  listSessions(): SessionInfo[] {
    return this.manager.listSessions();
  }

  async destroySession(id: string): Promise<void> {
    await this.manager.destroySession(id);
  }

  async write(sessionId: string, data: string, requester: Requester = 'human'): Promise<void> {
    const session = this.requireSession(sessionId);
    const scheduler = session.inputScheduler;
    if (!scheduler) {
      throw new Error(`Session ${sessionId} has no input scheduler`);
    }

    if (!scheduler.acquire(requester)) {
      await scheduler.enqueuePending(requester, data);
    }
    try {
      await session.write(data);
    } finally {
      scheduler.release();
    }
  }

  async runCommand(sessionId: string, command: string, requester: Requester = 'ai'): Promise<void> {
    await this.write(sessionId, `${command}\r`, requester);
  }

  read(sessionId: string, lines: number = 50): ScreenLine[] {
    return this.requireSession(sessionId).getScreenLines(lines);
  }

  readText(sessionId: string, lines: number = 50): string {
    return this.requireSession(sessionId).getLastOutput(lines);
  }

  resize(sessionId: string, cols: number, rows: number): void {
    this.requireSession(sessionId).resize(cols, rows);
  }

  interrupt(sessionId: string, by: Requester = 'human'): void {
    const session = this.requireSession(sessionId);
    session.interrupt();
    eventBus.emit({ type: 'session:interrupted', sessionId, by });
  }

  async close(sessionId: string): Promise<void> {
    const session = this.requireSession(sessionId);
    await session.close();
  }

  attach(sessionId: string): void {
    this.requireSession(sessionId);
    this.manager.attachAI(sessionId);
  }

  detach(sessionId: string): void {
    this.requireSession(sessionId);
    this.manager.detachAI(sessionId);
  }

  getCurrentPrompt(sessionId: string): string | null {
    return this.requireSession(sessionId).getCurrentPrompt();
  }

  async waitForPrompt(sessionId: string, timeoutMs: number = 30000): Promise<string> {
    return this.requireSession(sessionId).waitForPrompt(timeoutMs);
  }

  onOutput(sessionId: string, callback: (data: string) => void): () => void {
    return eventBus.on('session:output', (event) => {
      if (event.type === 'session:output' && event.sessionId === sessionId) {
        callback(event.data);
      }
    });
  }

  onPromptDetected(sessionId: string, callback: (prompt: string) => void): () => void {
    return eventBus.on('session:promptDetected', (event) => {
      if (event.type === 'session:promptDetected' && event.sessionId === sessionId) {
        callback(event.prompt);
      }
    });
  }

  onSessionEvent(sessionId: string, callback: (event: SessionEvent) => void): () => void {
    return eventBus.on('session:output', (event) => {
      if (event.sessionId === sessionId) {
        callback(event);
      }
    });
  }

  onAnyEvent(callback: (event: SessionEvent) => void): () => void {
    const types = ['session:output', 'session:promptDetected', 'session:commandComplete', 'session:error', 'session:closed', 'session:aiAttached', 'session:aiDetached', 'session:interrupted', 'inputArbiter:locked', 'inputArbiter:unlocked'] as const;
    const unsubs = types.map((t) => eventBus.on(t, callback));
    return () => {
      for (const unsub of unsubs) unsub();
    };
  }
}

export const sessionAPI = new SessionAPI();
export default SessionAPI;
