import type { CommandRecord, ConnectorConfig, PtyAdapter, RecordedEvent, Requester, ScreenLine, SessionConfig, SessionEvent, SessionInfo, SessionIntelligenceState, SessionSnapshot } from '../core/types.js';
import { SessionManager } from '../core/session-manager.js';
import { eventBus } from '../core/event-bus.js';
import { uuid } from '../utils/uuid.js';
import { detectDefaultShell, checkShellSpawnable, resolveShellPath } from '../utils/platform.js';
import { ConnectorManager, connectorManager } from '../connectors/connector-manager.js';
import { createSnapshot, applySnapshot } from '../ai/snapshot.js';
import { createPtyAdapter } from '../pty/factory.js';
import { WorkspaceManager, workspaceManager } from '../workspace/workspace-manager.js';
import type { WorkspaceInfo } from '../workspace/workspace.js';

export interface SessionApiOptions {
  defaultShell?: string;
  defaultShellArgs?: string[];
  defaultCwd?: string;
  cols?: number;
  rows?: number;
  adapterFactory?: () => PtyAdapter;
  manager?: SessionManager;
  connectors?: ConnectorManager;
  workspaces?: WorkspaceManager;
}

export interface SessionCreateOptions extends Partial<SessionConfig> {
  connector?: ConnectorConfig;
}

export class SessionAPI {
  private options: Required<Pick<SessionApiOptions, 'defaultShell' | 'defaultShellArgs' | 'defaultCwd' | 'cols' | 'rows'>> & SessionApiOptions;
  private manager: SessionManager;
  private connectors: ConnectorManager;
  private workspaces: WorkspaceManager;

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
    this.connectors = options.connectors ?? connectorManager;
    this.workspaces = options.workspaces ?? workspaceManager;
  }

  getSessionManager(): SessionManager {
    return this.manager;
  }

  getConnectors(): string[] {
    return this.connectors.list();
  }

  private createAdapter(): PtyAdapter {
    if (this.options.adapterFactory) {
      return this.options.adapterFactory();
    }
    return createPtyAdapter();
  }

  private requireSession(sessionId: string) {
    const session = this.manager.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }
    return session;
  }

  /** Derive a tab-like session label from the session's working directory. */
  private deriveName(cwd: string, shell: string, connector?: ConnectorConfig): string {
    // Remote/docker sessions: label by target instead of a local path.
    if (connector) {
      const target = connector.container || connector.distro || connector.host;
      if (target) return target;
    }
    // Prefer the shell's display name when the cwd is a root/home dir
    // (whose basename would be meaningless, e.g. `C:\` or `Admin`).
    const parsed = cwd.replace(/[\\/]+$/, '');
    const base = parsed.split(/[\\/]/).pop();
    if (base) {
      const shellName = shell.replace(/\.exe$/i, '').replace(/[\\/].*$/, '').split(/[\\/]/).pop() ?? 'shell';
      const homeish =
        /^[A-Za-z]:$/.test(parsed) ||
        base === 'Users' ||
        base === 'home' ||
        (process.env.USERPROFILE && cwd.replace(/[\\/]+$/, '').toLowerCase() === process.env.USERPROFILE.toLowerCase()) ||
        (process.env.HOME && cwd.replace(/[\\/]+$/, '').toLowerCase() === process.env.HOME.toLowerCase());
      if (!homeish) return base;
      return shellName;
    }
    return shell;
  }

  async createSession(options: SessionCreateOptions = {}): Promise<string> {
    const id = options.id ?? uuid();

    let shell = options.shell ?? this.options.defaultShell;
    let shellArgs = options.shellArgs ?? this.options.defaultShellArgs;
    let cwd = options.cwd ?? this.options.defaultCwd;
    let env = options.env ?? {};

    if (options.connector) {
      const resolved = this.connectors.resolve(options.connector);
      shell = options.shell ?? resolved.shell;
      shellArgs = options.shellArgs ?? resolved.shellArgs;
      cwd = options.cwd ?? resolved.cwd ?? this.options.defaultCwd;
      env = options.env ?? resolved.env ?? {};
    }

    const check = checkShellSpawnable(shell);
    if (!check.ok) {
      throw new Error(check.reason);
    }

    // Resolve a bare shell name to a real, node-pty-spawnable path (e.g. a
    // Store/MSIX pwsh alias -> C:\Program Files\WindowsApps\...\pwsh.exe).
    let spawnShell = shell;
    if (!options.connector) {
      spawnShell = resolveShellPath(shell) ?? shell;
    }

    const fullConfig: SessionConfig = {
      id,
      name: options.name ?? this.deriveName(cwd, spawnShell, options.connector),
      shell: spawnShell,
      shellArgs,
      cwd,
      cols: options.cols ?? this.options.cols,
      rows: options.rows ?? this.options.rows,
      env,
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
      await session.write(data, requester);
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

  attach(sessionId: string, agentId?: string): void {
    this.requireSession(sessionId);
    this.manager.attachAI(sessionId, agentId);
  }

  detach(sessionId: string, agentId?: string): void {
    this.requireSession(sessionId);
    this.manager.detachAI(sessionId, agentId);
  }

  getParticipants(sessionId: string): string[] {
    return this.requireSession(sessionId).getParticipants();
  }

  getPresence(sessionId: string): string {
    return this.requireSession(sessionId).getPresence();
  }

  startRecording(sessionId: string): void {
    this.requireSession(sessionId).startRecording();
  }

  stopRecording(sessionId: string): void {
    this.requireSession(sessionId).stopRecording();
  }

  isRecording(sessionId: string): boolean {
    return this.requireSession(sessionId).isRecording();
  }

  getRecording(sessionId: string): RecordedEvent[] {
    return this.requireSession(sessionId).getRecordingEvents();
  }

  getRecordingJsonl(sessionId: string): string {
    return this.requireSession(sessionId).getRecordingJsonl();
  }

  snapshot(sessionId: string): SessionSnapshot {
    return this.requireSession(sessionId).snapshot();
  }

  async restore(snapshot: SessionSnapshot): Promise<string> {
    const config = {
      id: snapshot.id,
      name: snapshot.name,
      shell: snapshot.shell,
      shellArgs: snapshot.shellArgs,
      cwd: snapshot.cwd,
      cols: snapshot.cols,
      rows: snapshot.rows,
      env: snapshot.env,
    };
    const session = this.manager.createSession(config);
    await session.start(this.createAdapter());
    applySnapshot(session, snapshot);
    return session.id;
  }

  createWorkspace(name: string): string {
    return this.workspaces.createWorkspace(name).id;
  }

  listWorkspaces(): WorkspaceInfo[] {
    return this.workspaces.listWorkspaces();
  }

  removeWorkspace(workspaceId: string): void {
    this.workspaces.removeWorkspace(workspaceId);
  }

  addToWorkspace(workspaceId: string, sessionId: string): void {
    this.requireSession(sessionId);
    this.workspaces.addToWorkspace(workspaceId, sessionId);
  }

  removeFromWorkspace(workspaceId: string, sessionId: string): void {
    this.workspaces.removeFromWorkspace(workspaceId, sessionId);
  }

  getWorkspaceSessions(workspaceId: string): string[] {
    const ws = this.workspaces.getWorkspace(workspaceId);
    if (!ws) {
      throw new Error(`Workspace ${workspaceId} not found`);
    }
    return ws.getSessionIds();
  }

  async runInWorkspace(workspaceId: string, command: string, requester: Requester = 'ai'): Promise<Record<string, string>> {
    const sessionIds = this.getWorkspaceSessions(workspaceId);
    const results: Record<string, string> = {};
    await Promise.all(
      sessionIds.map(async (sessionId) => {
        try {
          await this.runCommand(sessionId, command, requester);
          results[sessionId] = 'ok';
        } catch (err) {
          results[sessionId] = (err as Error).message;
        }
      }),
    );
    return results;
  }

  getWorkspaceStatus(workspaceId: string): Array<{ sessionId: string; state: string; presence: string; cwd: string }> {
    return this.getWorkspaceSessions(workspaceId).map((sessionId) => {
      const info = this.getSession(sessionId);
      const intelligence = this.getIntelligence(sessionId);
      return {
        sessionId,
        state: info.state,
        presence: this.getPresence(sessionId),
        cwd: intelligence.cwd,
      };
    });
  }

  getCurrentPrompt(sessionId: string): string | null {
    return this.requireSession(sessionId).getCurrentPrompt();
  }

  getIntelligence(sessionId: string): SessionIntelligenceState {
    return this.requireSession(sessionId).getIntelligenceState();
  }

  getHistory(sessionId: string): CommandRecord[] {
    return this.requireSession(sessionId).getIntelligenceState().commands;
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
