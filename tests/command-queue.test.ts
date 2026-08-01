import { describe, expect, test } from 'bun:test';
import { CommandQueue } from '../src/queue/command-queue.js';

describe('CommandQueue', () => {
  test('enqueue returns unique ids', () => {
    const q = new CommandQueue();
    const a = q.enqueue('ls', 'human');
    const b = q.enqueue('pwd', 'ai');
    expect(a).not.toBe(b);
  });

  test('dequeue returns commands in FIFO order with equal priority', () => {
    const q = new CommandQueue();
    q.enqueue('first', 'human');
    q.enqueue('second', 'ai');
    expect(q.dequeue()?.command).toBe('first');
    expect(q.dequeue()?.command).toBe('second');
    expect(q.dequeue()).toBeNull();
  });

  test('higher priority dequeues first', () => {
    const q = new CommandQueue();
    q.enqueue('low', 'ai', 0);
    q.enqueue('high', 'human', 10);
    expect(q.dequeue()?.command).toBe('high');
    expect(q.dequeue()?.command).toBe('low');
  });

  test('tracks requester metadata', () => {
    const q = new CommandQueue();
    q.enqueue('ls', 'ai', 5);
    const entry = q.dequeue();
    expect(entry?.requester).toBe('ai');
    expect(entry?.priority).toBe(5);
    expect(entry?.id).toBeTruthy();
  });

  test('peek does not remove', () => {
    const q = new CommandQueue();
    q.enqueue('ls', 'human');
    expect(q.peek()?.command).toBe('ls');
    expect(q.size()).toBe(1);
  });

  test('clear empties queue', () => {
    const q = new CommandQueue();
    q.enqueue('a', 'human');
    q.enqueue('b', 'ai');
    q.clear();
    expect(q.isEmpty()).toBe(true);
    expect(q.getPending()).toHaveLength(0);
  });

  test('getPending returns snapshot', () => {
    const q = new CommandQueue();
    q.enqueue('a', 'human');
    q.enqueue('b', 'ai');
    const snapshot = q.getPending();
    snapshot.length = 0;
    expect(q.size()).toBe(2);
  });
});
