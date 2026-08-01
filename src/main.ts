import { sessionManager } from './core/session-manager.js';
import { eventBus } from './core/event-bus.js';
import type { SessionEvent } from './core/types.js';

export function startRuntime(): void {
  console.log('CoTerm AI Session Runtime starting...');

  eventBus.on('session:output', (event: SessionEvent) => {
    if (event.type === 'session:output') {
      process.stdout.write(`[${event.sessionId}] ${event.data}`);
    }
  });

  eventBus.on('session:promptDetected', (event: SessionEvent) => {
    if (event.type === 'session:promptDetected') {
      console.log(`[${event.sessionId}] Prompt detected: ${event.prompt}`);
    }
  });

  eventBus.on('session:error', (event: SessionEvent) => {
    if (event.type === 'session:error') {
      console.error(`[${event.sessionId}] Error: ${event.error.message}`);
    }
  });

  eventBus.on('session:closed', (event: SessionEvent) => {
    if (event.type === 'session:closed') {
      console.log(`[${event.sessionId}] Session closed`);
    }
  });

  console.log('CoTerm runtime ready');
}

export function stopRuntime(): void {
  console.log('CoTerm runtime stopping...');
  eventBus.clear();
  console.log('CoTerm runtime stopped');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startRuntime();
}