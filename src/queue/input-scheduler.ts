import type { Requester } from '../core/types.js';

export class InputScheduler {
  private locked: boolean = false;
  private lockedBy: Requester | null = null;
  private pendingQueue: Array<{ requester: Requester; data: string; resolve: () => void }> = [];

  acquire(requester: Requester): boolean {
    if (!this.locked) {
      this.locked = true;
      this.lockedBy = requester;
      return true;
    }
    if (this.lockedBy === 'human' && requester === 'ai') {
      return false;
    }
    if (this.lockedBy === 'ai' && requester === 'human') {
      this.lockedBy = 'human';
      return true;
    }
    return false;
  }

  release(): void {
    this.locked = false;
    this.lockedBy = null;
  }

  isLocked(): boolean {
    return this.locked;
  }

  getLockedBy(): Requester | null {
    return this.lockedBy;
  }

  enqueuePending(requester: Requester, data: string): Promise<void> {
    return new Promise((resolve) => {
      this.pendingQueue.push({ requester, data, resolve });
    });
  }

  getPendingCount(): number {
    return this.pendingQueue.length;
  }
}