import * as path from 'node:path';
import type { CommandRecord, Requester, SessionIntelligenceState, SessionState } from '../core/types.js';
import { CommandTracker } from './command-tracker.js';
import { ScreenModeDetector } from './screen-mode-detector.js';
import { EnvDetector } from './env-detector.js';

const CD_PATTERNS = [
  /^(?:cd|Set-Location|Set-Location -Path)\s+(.+)$/i,
  /^\s*cd\s+~\/?(.*)$/,
];

export class SessionIntelligence {
  readonly commandTracker: CommandTracker;
  readonly screenMode: ScreenModeDetector;
  readonly env: EnvDetector;
  private cwd: string;
  private pendingCwd: string | null = null;

  constructor(cwd: string, options: { env?: EnvDetector } = {}) {
    this.cwd = cwd;
    this.commandTracker = new CommandTracker();
    this.screenMode = new ScreenModeDetector();
    this.env = options.env ?? new EnvDetector();
  }

  onOutput(data: string): void {
    this.screenMode.feed(data);
    this.commandTracker.accumulate(data);
  }

  recordCommand(command: string, requester: Requester): void {
    const cwdTarget = this.extractCwdTarget(command);
    if (cwdTarget) {
      this.pendingCwd = cwdTarget;
    }
    this.commandTracker.record(command, requester);
  }

  onPromptDetected(): void {
    this.commandTracker.complete();
    this.applyPendingCwd();
  }

  private extractCwdTarget(command: string): string | null {
    const line = command.trim().replace(/\r?\n/g, ' ');
    for (const pattern of CD_PATTERNS) {
      const match = line.match(pattern);
      if (match && match[1]) {
        return match[1].trim().replace(/^['"]|['"]$/g, '');
      }
    }
    return null;
  }

  private applyPendingCwd(): void {
    if (this.pendingCwd === null) return;
    const last = this.commandTracker.getLastCommand();
    if (last && last.error) {
      this.pendingCwd = null;
      return;
    }
    this.applyCwd(this.pendingCwd);
    this.pendingCwd = null;
  }

  private applyCwd(target: string): void {
    const home = process.env.USERPROFILE ?? process.env.HOME;
    let resolved = target;
    if (resolved === '~' || resolved.startsWith('~')) {
      if (home) resolved = resolved.replace(/^~/, home);
    }
    try {
      this.cwd = path.resolve(this.cwd, resolved);
    } catch {
      // leave cwd unchanged on invalid path
    }
  }

  getCwd(): string {
    return this.cwd;
  }

  setCwd(cwd: string): void {
    this.cwd = cwd;
  }

  getState(state: SessionState): SessionIntelligenceState {
    return {
      cwd: this.cwd,
      state,
      fullScreenApp: this.screenMode.isFullScreenApp(),
      toolchains: this.env.detect(),
      commands: this.commandTracker.getCommands(),
      currentCommand: this.commandTracker.getCurrentCommand(),
      lastCommand: this.commandTracker.getLastCommand(),
    };
  }
}

export default SessionIntelligence;
