import * as path from 'node:path';
import type { CommandRecord, Requester, SessionIntelligenceState, SessionState } from '../core/types.js';
import { CommandTracker } from './command-tracker.js';
import { ScreenModeDetector } from './screen-mode-detector.js';
import { EnvDetector } from './env-detector.js';

const CD_PATTERNS = [
  /^(?:cd|Set-Location|Set-Location -Path)\s+(.+)$/i,
  /^\s*cd\s+~\/?(.*)$/,
];

// Commands that move the session to a different environment (SSH host,
// WSL distro, docker container, remote shell). When one completes, the
// session is renamed to match, like a terminal tab showing where you are.
const ENV_SWITCH_PATTERNS = [
  // ssh [flags] user@host | ssh [flags] host — flags may carry values (-p 22, -i key).
  { pattern: /^ssh\s+(?:--?[\w-]+(?:\s+[\w./~:@-]+)?\s+)*([\w.-]+(?:@[\w.-]+)?)\s*$/, label: (m: RegExpMatchArray) => `ssh:${m[1]}` },
  { pattern: /^ssh\s+/, label: () => 'ssh' },
  { pattern: /^wsl\s+(?:-d\s+)?(\S+)?/i, label: (m: RegExpMatchArray) => (m[1] ? `wsl:${m[1]}` : 'wsl') },
  { pattern: /^wsl\b/i, label: () => 'wsl' },
  // docker exec/run — the container/image name is ambiguous vs flag values,
  // so just label the tab 'docker' to stay correct.
  { pattern: /^docker\s+(?:exec|run)\b/i, label: () => 'docker' },
];

export class SessionIntelligence {
  readonly commandTracker: CommandTracker;
  readonly screenMode: ScreenModeDetector;
  readonly env: EnvDetector;
  private cwd: string;
  private pendingCwd: string | null = null;
  private pendingLabel: string | null = null;
  private onLabelChange: ((label: string) => void) | null = null;

  constructor(cwd: string, options: { env?: EnvDetector } = {}) {
    this.cwd = cwd;
    this.commandTracker = new CommandTracker();
    this.screenMode = new ScreenModeDetector();
    this.env = options.env ?? new EnvDetector();
  }

  /** Called when the session should be renamed to reflect the active target. */
  onRename(cb: (label: string) => void): void {
    this.onLabelChange = cb;
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
    const label = this.extractEnvSwitchLabel(command);
    // A pending rename only applies to the very next prompt. If the user
    // issues a different command first (or ssh hangs waiting for a password),
    // the pending label is stale — clear it so it isn't applied later.
    this.pendingLabel = label ?? null;
    this.commandTracker.record(command, requester);
  }

  onPromptDetected(): void {
    this.commandTracker.complete();
    this.applyPendingCwd();
    this.applyPendingLabel();
  }

  private extractEnvSwitchLabel(command: string): string | null {
    const line = command.trim().replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
    for (const entry of ENV_SWITCH_PATTERNS) {
      const match = line.match(entry.pattern);
      if (match) return entry.label(match);
    }
    return null;
  }

  private applyPendingLabel(): void {
    if (this.pendingLabel === null) return;
    const last = this.commandTracker.getLastCommand();
    // Only rename on success (e.g. `ssh` that failed to connect shouldn't stick).
    if (last && last.error) {
      this.pendingLabel = null;
      return;
    }
    this.onLabelChange?.(this.pendingLabel);
    this.pendingLabel = null;
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
