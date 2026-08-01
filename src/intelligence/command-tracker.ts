import type { CommandRecord, Requester } from '../core/types.js';
import { uuid } from '../utils/uuid.js';

const ERROR_PATTERNS = [
  /error/i,
  /\berr\b/i,
  /failed/i,
  /failure/i,
  /exception/i,
  /fatal:/i,
  /traceback/i,
  /cannot find/i,
  /找不到/i,
  /not recognized/i,
  /is not recognized/i,
  /command not found/i,
  /no such file/i,
  /permission denied/i,
  /denied:/i,
];

export function hasErrorIndicator(output: string): boolean {
  return ERROR_PATTERNS.some((re) => re.test(output));
}

export interface CommandTrackerOptions {
  maxCommands?: number;
  maxOutputBuffer?: number;
}

export class CommandTracker {
  private commands: CommandRecord[] = [];
  private current: CommandRecord | null = null;
  private accumulatedOutput: string = '';
  private maxCommands: number;
  private maxOutputBuffer: number;

  constructor(options: CommandTrackerOptions = {}) {
    this.maxCommands = options.maxCommands ?? 500;
    this.maxOutputBuffer = options.maxOutputBuffer ?? 8192;
  }

  record(command: string, requester: Requester): void {
    if (this.current) {
      this.complete();
    }
    this.accumulatedOutput = '';
    this.current = {
      id: uuid(),
      command,
      requester,
      startedAt: Date.now(),
    };
    this.commands.push(this.current);
    if (this.commands.length > this.maxCommands) {
      this.commands = this.commands.slice(this.commands.length - this.maxCommands);
    }
  }

  accumulate(output: string): void {
    if (!this.current) return;
    if (output.length > 0) {
      this.accumulatedOutput = (this.accumulatedOutput + output).slice(-this.maxOutputBuffer);
    }
  }

  complete(exitCode?: number): void {
    if (!this.current) return;
    this.current.durationMs = Date.now() - this.current.startedAt;
    if (exitCode !== undefined) {
      this.current.exitCode = exitCode;
    }
    this.current.error = hasErrorIndicator(this.accumulatedOutput);
    this.current.outputPreview = this.accumulatedOutput.trim().slice(-1000);
    this.accumulatedOutput = '';
    this.current = null;
  }

  getCommands(): CommandRecord[] {
    return [...this.commands];
  }

  getLastCommand(): CommandRecord | undefined {
    return this.commands[this.commands.length - 1];
  }

  getCurrentCommand(): CommandRecord | null {
    return this.current;
  }

  getAccumulatedOutput(): string {
    return this.accumulatedOutput;
  }
}

export default CommandTracker;
