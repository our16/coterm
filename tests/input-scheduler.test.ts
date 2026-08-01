import { describe, expect, test } from 'bun:test';
import { InputScheduler } from '../src/queue/input-scheduler.js';

describe('InputScheduler', () => {
  test('acquire takes lock when free', () => {
    const s = new InputScheduler();
    expect(s.acquire('human')).toBe(true);
    expect(s.isLocked()).toBe(true);
    expect(s.getLockedBy()).toBe('human');
  });

  test('release frees the lock', () => {
    const s = new InputScheduler();
    s.acquire('human');
    s.release();
    expect(s.isLocked()).toBe(false);
    expect(s.getLockedBy()).toBeNull();
  });

  test('human always preempts AI', () => {
    const s = new InputScheduler();
    s.acquire('ai');
    expect(s.acquire('human')).toBe(true);
    expect(s.getLockedBy()).toBe('human');
  });

  test('AI cannot preempt human', () => {
    const s = new InputScheduler();
    s.acquire('human');
    expect(s.acquire('ai')).toBe(false);
    expect(s.getLockedBy()).toBe('human');
  });

  test('AI cannot acquire while AI holds lock', () => {
    const s = new InputScheduler();
    s.acquire('ai');
    expect(s.acquire('ai')).toBe(false);
  });

  test('enqueuePending waits and resolves when lock is released', async () => {
    const s = new InputScheduler();
    s.acquire('human');

    let resolved = false;
    const pending = s.enqueuePending('ai', 'ls\r').then(() => {
      resolved = true;
    });

    await Promise.resolve();
    expect(resolved).toBe(false);
    expect(s.getPendingCount()).toBe(1);

    s.release();
    await pending;
    expect(resolved).toBe(true);
    expect(s.getLockedBy()).toBe('ai');
  });

  test('release flushes pending queue in order', async () => {
    const s = new InputScheduler();
    s.acquire('human');
    const order: string[] = [];
    const p1 = s.enqueuePending('ai', 'one').then(() => order.push('one'));
    const p2 = s.enqueuePending('ai', 'two').then(() => order.push('two'));

    s.release();
    await p1;
    expect(order).toEqual(['one']);
    expect(s.getLockedBy()).toBe('ai');

    s.release();
    await p2;
    expect(order).toEqual(['one', 'two']);
    expect(s.getPendingCount()).toBe(0);
  });
});
