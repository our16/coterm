import { Workspace, type WorkspaceInfo } from './workspace.js';
import { uuid } from '../utils/uuid.js';

export class WorkspaceManager {
  private workspaces = new Map<string, Workspace>();

  createWorkspace(name: string): Workspace {
    const id = uuid();
    const workspace = new Workspace(name, id);
    this.workspaces.set(id, workspace);
    return workspace;
  }

  getWorkspace(id: string): Workspace | undefined {
    return this.workspaces.get(id);
  }

  removeWorkspace(id: string): void {
    this.workspaces.delete(id);
  }

  addToWorkspace(workspaceId: string, sessionId: string): void {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) {
      throw new Error(`Workspace ${workspaceId} not found`);
    }
    workspace.addSession(sessionId);
  }

  removeFromWorkspace(workspaceId: string, sessionId: string): void {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) {
      throw new Error(`Workspace ${workspaceId} not found`);
    }
    workspace.removeSession(sessionId);
  }

  listWorkspaces(): WorkspaceInfo[] {
    const infos: WorkspaceInfo[] = [];
    for (const ws of this.workspaces.values()) {
      infos.push(ws.getInfo());
    }
    return infos;
  }
}

export const workspaceManager = new WorkspaceManager();
export default WorkspaceManager;
