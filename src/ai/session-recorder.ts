import type { RecordedEvent, SessionEvent } from '../core/types.js';
import { uuid } from '../utils/uuid.js';

export class SessionRecorder {
  private recording = false;
  private events: RecordedEvent[] = [];
  private maxEvents: number;

  constructor(maxEvents: number = 100000) {
    this.maxEvents = maxEvents;
  }

  start(): void {
    this.recording = true;
  }

  stop(): void {
    this.recording = false;
  }

  isRecording(): boolean {
    return this.recording;
  }

  record(event: SessionEvent): void {
    if (!this.recording) return;
    const { type, sessionId, ...rest } = event as { type: SessionEvent['type']; sessionId: string } & Record<string, unknown>;
    const entry: RecordedEvent = {
      id: uuid(),
      type,
      sessionId,
      timestamp: Date.now(),
      data: rest,
    };
    this.events.push(entry);
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(this.events.length - this.maxEvents);
    }
  }

  getEvents(): RecordedEvent[] {
    return [...this.events];
  }

  toJsonl(): string {
    return this.events.map((e) => JSON.stringify(e)).join('\n');
  }

  clear(): void {
    this.events = [];
  }
}

export default SessionRecorder;
