import type { SessionConfig, SessionInfo, SessionEvent } from './types.js';
import { Session } from './session.js';
import { eventBus } from './event-bus.js';
import type { PtyAdapter } from './types.js';

export class SessionManager {
  private sessions: Map<string, Session> = new Map();

  createSession(config: SessionConfig): Session {
    if (this.sessions.has(config.id)) {
      throw new Error(`Session with id ${config.id} already exists`);
    }
    const session = new Session(config);
    this.sessions.set(config.id, session);
    return session;
  }

  getSession(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  listSessions(): SessionInfo[] {
    const infos: SessionInfo[] = [];
    for (const session of this.sessions.values()) {
      infos.push(session.getInfo());
    }
    return infos;
  }

  async destroySession(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) {
      throw new Error(`Session with id ${id} not found`);
    }
    await session.close();
    this.sessions.delete(id);
  }

  async attachAI(sessionId: string, agentId?: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session with id ${sessionId} not found`);
    }
    session.owner = 'ai';
    if (agentId) {
      session.attachAgent(agentId);
    } else {
      eventBus.emit({ type: 'session:aiAttached', sessionId });
    }
  }

  async detachAI(sessionId: string, agentId?: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session with id ${sessionId} not found`);
    }
    if (agentId) {
      session.detachAgent(agentId);
    }
    if (!agentId || session.getParticipants().length === 0) {
      session.owner = 'human';
      eventBus.emit({ type: 'session:aiDetached', sessionId, agent: agentId });
    }
  }

  acquireWriteLock(sessionId: string, requester: 'human' | 'ai'): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || !session.inputScheduler) {
      return false;
    }
    return session.inputScheduler.acquire(requester);
  }

  releaseWriteLock(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session || !session.inputScheduler) {
      return;
    }
    session.inputScheduler.release();
  }
}

export const sessionManager = new SessionManager();
export default SessionManager;