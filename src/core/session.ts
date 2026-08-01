import type { SessionConfig, SessionState, SessionEvent, ScreenLine, PtyAdapter, Requester, CommandEntry } from './types.js';
import { eventBus } from './event-bus.js';
import { ScreenBuffer } from '../buffer/screen-buffer.js';
import { PromptDetector } from '../buffer/prompt-detector.js';
import { CommandQueue } from '../queue/command-queue.js';
import { InputScheduler } from '../queue/input-scheduler.js';

export class Session {
  public readonly id: string;
  public readonly name: string;
  public readonly config: SessionConfig;
  public state: SessionState = 'created';
  public owner: Requester = 'human';
  public readonly createdAt: number;
  public pty: PtyAdapter | null = null;
  public screenBuffer: ScreenBuffer | null = null;
  public promptDetector: PromptDetector | null = null;
  public commandQueue: CommandQueue | null = null;
  public inputScheduler: InputScheduler | null = null;

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
    eventBus.emit({ type: 'session:output', sessionId: this.id, data: `Starting session ${this.id}...` });

    this.screenBuffer = new ScreenBuffer();
    this.promptDetector = new PromptDetector(this.config.shell);
    this.commandQueue = new CommandQueue();
    this.inputScheduler = new InputScheduler();

    this.pty.onOutput((data) => {
      this.handleOutput(data);
    });

    this.pty.onExit((code) => {
      this.handleExit(code);
    });

    try {
      await this.pty.spawn(this.config.shell, this.config.shellArgs, this.config.cwd, this.config.env);
      this.state = 'running';
      eventBus.emit({ type: 'session:output', sessionId: this.id, data: `Session ${this.id} started` });
    } catch (err) {
      this.state = 'error';
      eventBus.emit({ type: 'session:error', sessionId: this.id, error: err as Error });
      throw err;
    }
  }

  private handleOutput(data: string): void {
    if (!this.screenBuffer) return;

    this.screenBuffer.append(data);
    eventBus.emit({ type: 'session:output', sessionId: this.id, data });

    if (this.promptDetector) {
      const prompt = this.promptDetector.detect(data);
      if (prompt) {
        eventBus.emit({ type: 'session:promptDetected', sessionId: this.id, prompt });
      }
    }
  }

  private handleExit(code: number): void {
    this.state = 'closed';
    eventBus.emit({ type: 'session:commandComplete', sessionId: this.id, exitCode: code });
    eventBus.emit({ type: 'session:closed', sessionId: this.id });
  }

  async write(data: string): Promise<void> {
    if (!this.pty) {
      throw new Error(`Session ${this.id} has no PTY adapter`);
    }
    if (this.state !== 'running' && this.state !== 'active' && this.state !== 'paused') {
      throw new Error(`Cannot write to session in state ${this.state}`);
    }
    await this.pty.write(data);
  }

  resize(cols: number, rows: number): void {
    if (this.pty) {
      this.pty.resize(cols, rows);
    }
  }

  interrupt(): void {
    if (this.pty) {
      this.pty.write('\x03');
    }
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

  getInfo(): { id: string; name: string; state: SessionState; shell: string; cwd: string; createdAt: number; owner: Requester } {
    return {
      id: this.id,
      name: this.name,
      state: this.state,
      shell: this.config.shell,
      cwd: this.config.cwd,
      createdAt: this.createdAt,
      owner: this.owner,
    };
  }
}