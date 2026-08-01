import { uuid } from '../utils/uuid.js';

export interface WorkspaceInfo {
  id: string;
  name: string;
  sessionIds: string[];
  createdAt: number;
}

export class Workspace {
  readonly id: string;
  name: string;
  readonly createdAt: number;
  private sessionIds: string[] = [];

  constructor(name: string, id?: string) {
    this.id = id ?? uuid();
    this.name = name;
    this.createdAt = Date.now();
  }

  addSession(sessionId: string): void {
    if (!this.sessionIds.includes(sessionId)) {
      this.sessionIds.push(sessionId);
    }
  }

  removeSession(sessionId: string): void {
    this.sessionIds = this.sessionIds.filter((id) => id !== sessionId);
  }

  hasSession(sessionId: string): boolean {
    return this.sessionIds.includes(sessionId);
  }

  getSessionIds(): string[] {
    return [...this.sessionIds];
  }

  getInfo(): WorkspaceInfo {
    return {
      id: this.id,
      name: this.name,
      sessionIds: [...this.sessionIds],
      createdAt: this.createdAt,
    };
  }
}

export default Workspace;
