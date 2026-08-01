import type { PresenceState, SessionConfig, SessionState, SessionEvent, ScreenLine, PtyAdapter, Requester, CommandEntry, SessionIntelligenceState } from './types.js';
import { eventBus } from './event-bus.js';
import { ScreenBuffer } from '../buffer/screen-buffer.js';
import { PromptDetector } from '../buffer/prompt-detector.js';
import { CommandQueue } from '../queue/command-queue.js';
import { InputScheduler } from '../queue/input-scheduler.js';
import { SessionIntelligence } from '../intelligence/session-intelligence.js';
import { SessionRecorder } from '../ai/session-recorder.js';
import { createSnapshot } from '../ai/snapshot.js';

export class Session {
  public readonly id: string;
  public name: string;
  public readonly config: SessionConfig;
  public state: SessionState = 'created';
  public owner: Requester = 'human';
  public readonly createdAt: number;
  public pty: PtyAdapter | null = null;
  public screenBuffer: ScreenBuffer | null = null;
  public promptDetector: PromptDetector | null = null;
  public commandQueue: CommandQueue | null = null;
  public inputScheduler: InputScheduler | null = null;
  public intelligence: SessionIntelligence | null = null;
  public recorder: SessionRecorder | null = null;
  public participants: string[] = [];
  public presence: PresenceState = 'idle';
  private rawLog: string = '';
  private readonly rawLogMax = 1024 * 1024;

  constructor(config: SessionConfig) {
    this.id = config.id;
    this.name = config.name;
    this.config = config;
    this.createdAt = Date.now();
  }

  async start(pty: PtyAdapter): Promise<void> {
    if (this.state !== 'created' && this.state !== 'error') {
      throw new Error(`Cannot start session in state ${this.state}`);
    }

    this.pty = pty;
    this.state = 'starting';
    this.record({ type: 'session:output', sessionId: this.id, data: `Starting session ${this.id}...` });
    eventBus.emit({ type: 'session:output', sessionId: this.id, data: `Starting session ${this.id}...` });

    this.screenBuffer = new ScreenBuffer();
    this.promptDetector = new PromptDetector(this.config.shell);
    this.commandQueue = new CommandQueue();
    this.inputScheduler = new InputScheduler();
    this.intelligence = new SessionIntelligence(this.config.cwd);
    // Rename the session tab when the user ssh's / wsl's / docker exec's,
    // so the session list shows where the shell actually is.
    this.intelligence.onRename((label) => this.setName(label));
    this.recorder = new SessionRecorder();

    this.pty.onOutput((data) => {
      this.handleOutput(data);
    });

    this.pty.onExit((code) => {
      this.handleExit(code);
    });

    try {
      await this.pty.spawn(this.config.shell, this.config.shellArgs, this.config.cwd, this.config.env);
      this.state = 'running';
      this.record({ type: 'session:output', sessionId: this.id, data: `Session ${this.id} started` });
      eventBus.emit({ type: 'session:output', sessionId: this.id, data: `Session ${this.id} started` });
    } catch (err) {
      this.state = 'error';
      this.record({ type: 'session:error', sessionId: this.id, error: err as Error });
      eventBus.emit({ type: 'session:error', sessionId: this.id, error: err as Error });
      throw err;
    }
  }

  private record(event: SessionEvent): void {
    this.recorder?.record(event);
  }

  setPresence(presence: PresenceState): void {
    if (this.presence === presence) return;
    this.presence = presence;
    this.record({ type: 'session:presence', sessionId: this.id, presence });
    eventBus.emit({ type: 'session:presence', sessionId: this.id, presence });
  }

  getPresence(): PresenceState {
    return this.presence;
  }

  private handleOutput(data: string): void {
    if (!this.screenBuffer) return;

    this.rawLog = (this.rawLog + data).slice(-this.rawLogMax);
    this.screenBuffer.append(data);
    this.intelligence?.onOutput(data);
    this.record({ type: 'session:output', sessionId: this.id, data });
    eventBus.emit({ type: 'session:output', sessionId: this.id, data });

    if (this.promptDetector) {
      const prompt = this.promptDetector.detect(data);
      if (prompt) {
        this.intelligence?.onPromptDetected();
        this.record({ type: 'session:promptDetected', sessionId: this.id, prompt });
        eventBus.emit({ type: 'session:promptDetected', sessionId: this.id, prompt });
        this.setPresence(this.participants.length > 0 ? 'ai-thinking' : 'idle');
      }
    }
  }

  /** Raw PTY output from a byte offset (for terminal streaming/attach). */
  getRawOutput(from: number): { text: string; offset: number } {
    return { text: this.rawLog.slice(from), offset: this.rawLog.length };
  }

  private handleExit(code: number): void {
    this.state = 'closed';
    this.record({ type: 'session:commandComplete', sessionId: this.id, exitCode: code });
    this.record({ type: 'session:closed', sessionId: this.id });
    eventBus.emit({ type: 'session:commandComplete', sessionId: this.id, exitCode: code });
    eventBus.emit({ type: 'session:closed', sessionId: this.id });
  }

  async write(data: string, requester?: Requester): Promise<void> {
    if (!this.pty) {
      throw new Error(`Session ${this.id} has no PTY adapter`);
    }
    if (this.state !== 'running' && this.state !== 'active' && this.state !== 'paused') {
      throw new Error(`Cannot write to session in state ${this.state}`);
    }
    this.recordEnterCommand(data, requester ?? this.owner);
    this.setPresence(requester === 'human' ? 'human-typing' : 'ai-running');
    await this.pty.write(data);
  }

  private recordEnterCommand(data: string, requester: Requester): void {
    if (!this.intelligence) return;
    const lastEnter = data.lastIndexOf('\r');
    if (lastEnter === -1) return;
    let command = data.slice(0, lastEnter + 1).replace(/[\r\n]/g, '').trim();
    if (!command) return;
    this.intelligence.recordCommand(command, requester);
  }

  resize(cols: number, rows: number): void {
    if (this.pty) {
      this.pty.resize(cols, rows);
    }
  }

  interrupt(): void {
    this.setPresence('idle');
    if (this.pty) {
      this.pty.write('\x03');
    }
  }

  attachAgent(agentId: string): void {
    if (!this.participants.includes(agentId)) {
      this.participants.push(agentId);
    }
    if (this.presence === 'idle') {
      this.setPresence('ai-thinking');
    }
    this.record({ type: 'session:aiAttached', sessionId: this.id, agent: agentId });
  }

  detachAgent(agentId: string): void {
    this.participants = this.participants.filter((a) => a !== agentId);
    if (this.participants.length === 0 && this.presence === 'ai-thinking') {
      this.setPresence('idle');
    }
    this.record({ type: 'session:aiDetached', sessionId: this.id, agent: agentId });
  }

  getParticipants(): string[] {
    return [...this.participants];
  }

  startRecording(): void {
    this.recorder?.start();
    this.record({ type: 'session:recorded', sessionId: this.id, recording: true });
  }

  stopRecording(): void {
    this.recorder?.stop();
    this.record({ type: 'session:recorded', sessionId: this.id, recording: false });
  }

  isRecording(): boolean {
    return this.recorder?.isRecording() ?? false;
  }

  getRecordingEvents(): import('./types.js').RecordedEvent[] {
    return this.recorder?.getEvents() ?? [];
  }

  getRecordingJsonl(): string {
    return this.recorder?.toJsonl() ?? '';
  }

  snapshot() {
    return createSnapshot(this);
  }

  async close(): Promise<void> {
    if (this.pty) {
      await this.pty.destroy();
      this.pty = null;
    }
    this.state = 'closed';
    eventBus.emit({ type: 'session:closed', sessionId: this.id });
  }

  getLastOutput(n: number): string {
    if (!this.screenBuffer) return '';
    return this.screenBuffer.getLastLines(n).map((line) => line.text).join('\n');
  }

  getScreenLines(n: number): ScreenLine[] {
    if (!this.screenBuffer) return [];
    return this.screenBuffer.getLastLines(n);
  }

  getCurrentPrompt(): string | null {
    if (!this.promptDetector) return null;
    return this.promptDetector.getLastPrompt();
  }

  waitForPrompt(timeoutMs: number = 30000): Promise<string> {
    return new Promise((resolve, reject) => {
      let unsub: () => void = () => {};
      const timer = setTimeout(() => {
        unsub();
        reject(new Error(`Timed out after ${timeoutMs}ms waiting for prompt`));
      }, timeoutMs);

      unsub = eventBus.on('session:promptDetected', (event) => {
        if (event.type === 'session:promptDetected' && event.sessionId === this.id) {
          clearTimeout(timer);
          unsub();
          resolve(event.prompt);
        }
      });
    });
  }

  getState(): SessionState {
    return this.state;
  }

  getIntelligenceState(): SessionIntelligenceState {
    if (!this.intelligence) {
      return {
        cwd: this.config.cwd,
        state: this.state,
        fullScreenApp: false,
        toolchains: {},
        commands: [],
        currentCommand: null,
        lastCommand: undefined,
      };
    }
    return this.intelligence.getState(this.state);
  }

  getInfo(): { id: string; name: string; state: SessionState; shell: string; cwd: string; createdAt: number; owner: Requester; presence: PresenceState } {
    return {
      id: this.id,
      name: this.name,
      state: this.state,
      shell: this.config.shell,
      cwd: this.config.cwd,
      createdAt: this.createdAt,
      owner: this.owner,
      presence: this.presence,
    };
  }

  /** Rename the session (used when the shell switches target, e.g. `ssh`). */
  setName(name: string): void {
    this.name = name;
    this.record({ type: 'session:renamed', sessionId: this.id, name });
    eventBus.emit({ type: 'session:renamed', sessionId: this.id, name });
  }
}