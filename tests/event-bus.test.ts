import { describe, expect, test } from 'bun:test';
import { EventBus } from '../src/core/event-bus.js';

describe('EventBus', () => {
  test('emits to subscribed handlers', () => {
    const bus = new EventBus();
    const received: string[] = [];
    bus.on('session:output', (event) => {
      if (event.type === 'session:output') received.push(event.data);
    });
    bus.emit({ type: 'session:output', sessionId: 's1', data: 'hello' });
    expect(received).toEqual(['hello']);
  });

  test('unsubscribes via returned function', () => {
    const bus = new EventBus();
    let count = 0;
    const unsub = bus.on('session:promptDetected', () => count++);
    bus.emit({ type: 'session:promptDetected', sessionId: 's1', prompt: 'PS>' });
    unsub();
    bus.emit({ type: 'session:promptDetected', sessionId: 's1', prompt: 'PS>' });
    expect(count).toBe(1);
  });

  test('off removes a specific handler', () => {
    const bus = new EventBus();
    let count = 0;
    const handler = () => count++;
    bus.on('session:closed', handler);
    bus.emit({ type: 'session:closed', sessionId: 's1' });
    bus.off('session:closed', handler);
    bus.emit({ type: 'session:closed', sessionId: 's1' });
    expect(count).toBe(1);
  });

  test('handler errors do not break other handlers', () => {
    const bus = new EventBus();
    let otherRan = false;
    const originalError = console.error;
    console.error = () => {};
    try {
      bus.on('session:output', () => {
        throw new Error('boom');
      });
      bus.on('session:output', () => {
        otherRan = true;
      });
      bus.emit({ type: 'session:output', sessionId: 's1', data: 'x' });
      expect(otherRan).toBe(true);
    } finally {
      console.error = originalError;
    }
  });

  test('clear removes all handlers', () => {
    const bus = new EventBus();
    let count = 0;
    bus.on('session:error', () => count++);
    bus.clear();
    bus.emit({ type: 'session:error', sessionId: 's1', error: new Error('e') });
    expect(count).toBe(0);
  });
});
