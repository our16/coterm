import type { SessionEvent } from './types.js';

type EventHandler = (event: SessionEvent) => void;

class EventBus {
  private handlers: Map<string, Set<EventHandler>> = new Map();

  on(eventType: SessionEvent['type'], handler: EventHandler): () => void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }
    this.handlers.get(eventType)!.add(handler);

    return () => {
      this.handlers.get(eventType)?.delete(handler);
    };
  }

  emit(event: SessionEvent): void {
    const handlers = this.handlers.get(event.type);
    if (!handlers) return;
    for (const handler of handlers) {
      try {
        handler(event);
      } catch (err) {
        console.error(`EventBus handler error for ${event.type}:`, err);
      }
    }
  }

  off(eventType: SessionEvent['type'], handler: EventHandler): void {
    this.handlers.get(eventType)?.delete(handler);
  }

  clear(): void {
    this.handlers.clear();
  }
}

export const eventBus = new EventBus();
export default EventBus;