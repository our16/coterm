import type { CommandEntry, Requester } from '../core/types.js';
import { uuid } from '../utils/uuid.js';

export class CommandQueue {
  private queue: CommandEntry[] = [];
  private current: CommandEntry | null = null;

  enqueue(command: string, requester: Requester, priority: number = 0): string {
    const id = uuid();
    const entry: CommandEntry = {
      id,
      command,
      requester,
      priority,
      timestamp: Date.now(),
    };
    this.queue.push(entry);
    this.queue.sort((a, b) => b.priority - a.priority || a.timestamp - b.timestamp);
    return id;
  }

  dequeue(): CommandEntry | null {
    if (this.queue.length === 0) return null;
    this.current = this.queue.shift() ?? null;
    return this.current;
  }

  peek(): CommandEntry | null {
    return this.queue[0] ?? null;
  }

  clear(): void {
    this.queue = [];
    this.current = null;
  }

  getPending(): CommandEntry[] {
    return [...this.queue];
  }

  getCurrent(): CommandEntry | null {
    return this.current;
  }

  isEmpty(): boolean {
    return this.queue.length === 0;
  }

  size(): number {
    return this.queue.length;
  }
}