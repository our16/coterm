import type { SessionAPI } from '../api/session-api.js';
import { VERSION } from '../version.js';

export interface ToolResult {
  text: string;
  isError?: boolean;
}

export function ok(text: string): ToolResult {
  return { text };
}

export function err(message: string): ToolResult {
  return { text: message, isError: true };
}

export async function executeTool(api: SessionAPI, name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
  switch (name) {
    case 'system_info':
      return ok(JSON.stringify({ name: 'coterm', version: VERSION, pid: process.pid }));
    case 'system_stop':
      // Ask the daemon to exit so the caller can start a fresh one.
      setTimeout(() => process.exit(0), 10);
      return ok('stopping');
    case 'terminal_create': {
      const a = args as { name?: string; shell?: string; shellArgs?: string[]; cwd?: string; cols?: number; rows?: number; connector?: unknown };
      try {
        const sessionId = await api.createSession({ ...a, connector: a.connector as never });
        return ok(JSON.stringify({ sessionId }));
      } catch (e) {
        return err(`Failed to create session: ${(e as Error).message}`);
      }
    }
    case 'terminal_list':
      return ok(JSON.stringify(api.listSessions(), null, 2));
    case 'terminal_attach': {
      const { sessionId, agent } = args as { sessionId: string; agent?: string };
      try {
        api.attach(sessionId, agent);
        return ok(`Attached AI${agent ? ` ${agent}` : ''} to session ${sessionId}`);
      } catch (e) {
        return err((e as Error).message);
      }
    }
    case 'terminal_detach': {
      const { sessionId, agent } = args as { sessionId: string; agent?: string };
      try {
        api.detach(sessionId, agent);
        return ok(`Detached AI${agent ? ` ${agent}` : ''} from session ${sessionId}`);
      } catch (e) {
        return err((e as Error).message);
      }
    }
    case 'terminal_read': {
      const { sessionId, lines } = args as { sessionId: string; lines?: number };
      try {
        const output = api.readText(sessionId, lines ?? 50);
        return ok(output || '(no output yet)');
      } catch (e) {
        return err((e as Error).message);
      }
    }
    case 'terminal_write': {
      const { sessionId, data } = args as { sessionId: string; data: string };
      try {
        await api.write(sessionId, data, 'ai');
        return ok(`Wrote ${data.length} chars to session ${sessionId}`);
      } catch (e) {
        return err((e as Error).message);
      }
    }
    case 'terminal_run': {
      const { sessionId, command, timeout } = args as { sessionId: string; command: string; timeout?: number };
      try {
        const limit = timeout ?? 30000;
        await api.runCommand(sessionId, command, 'ai');
        const needle = command.trim();
        const deadline = Date.now() + limit;
        let output = '';
        while (Date.now() < deadline) {
          const remaining = deadline - Date.now();
          await api.waitForPrompt(sessionId, Math.max(1000, Math.min(remaining, 10000)));
          output = api.readText(sessionId, 100).trim();
          // Only treat it as complete once the shell has echoed our command
          // (otherwise the first prompt of a fresh session is misread).
          if (output.includes(needle)) break;
        }
        return ok(`Command finished.\n\n${output || '(no output)'}`);
      } catch (e) {
        return err(`Command did not complete: ${(e as Error).message}`);
      }
    }
    case 'terminal_wait_prompt': {
      const { sessionId, timeout } = args as { sessionId: string; timeout?: number };
      try {
        const prompt = await api.waitForPrompt(sessionId, timeout ?? 30000);
        return ok(`Prompt detected: ${JSON.stringify(prompt)}`);
      } catch (e) {
        return err((e as Error).message);
      }
    }
    case 'terminal_resize': {
      const { sessionId, cols, rows } = args as { sessionId: string; cols: number; rows: number };
      try {
        api.resize(sessionId, cols, rows);
        return ok(`Resized session ${sessionId} to ${cols}x${rows}`);
      } catch (e) {
        return err((e as Error).message);
      }
    }
    case 'terminal_interrupt': {
      const { sessionId } = args as { sessionId: string };
      try {
        api.interrupt(sessionId, 'ai');
        return ok(`Interrupted session ${sessionId}`);
      } catch (e) {
        return err((e as Error).message);
      }
    }
    case 'terminal_status': {
      const { sessionId } = args as { sessionId: string };
      try {
        const intelligence = api.getIntelligence(sessionId);
        const info = api.getSession(sessionId);
        const presence = api.getPresence(sessionId);
        const participants = api.getParticipants(sessionId);
        return ok(JSON.stringify({ ...intelligence, presence, participants, info }, null, 2));
      } catch (e) {
        return err((e as Error).message);
      }
    }
    case 'terminal_history': {
      const { sessionId, limit } = args as { sessionId: string; limit?: number };
      try {
        const history = api.getHistory(sessionId).slice(-(limit ?? 50));
        return ok(JSON.stringify(history, null, 2));
      } catch (e) {
        return err((e as Error).message);
      }
    }
    case 'terminal_recording': {
      const { sessionId, action } = args as { sessionId: string; action: 'start' | 'stop' };
      try {
        if (action === 'start') {
          api.startRecording(sessionId);
          return ok(`Recording started for session ${sessionId}`);
        }
        api.stopRecording(sessionId);
        return ok(`Recording stopped for session ${sessionId}`);
      } catch (e) {
        return err((e as Error).message);
      }
    }
    case 'terminal_replay': {
      const { sessionId, format } = args as { sessionId: string; format?: 'jsonl' | 'json' };
      try {
        const body = (format ?? 'jsonl') === 'jsonl' ? api.getRecordingJsonl(sessionId) : JSON.stringify(api.getRecording(sessionId), null, 2);
        return ok(body || '(no recorded events)');
      } catch (e) {
        return err((e as Error).message);
      }
    }
    case 'terminal_snapshot': {
      const { sessionId } = args as { sessionId: string };
      try {
        return ok(JSON.stringify(api.snapshot(sessionId)));
      } catch (e) {
        return err((e as Error).message);
      }
    }
    case 'terminal_restore': {
      const { snapshot } = args as { snapshot: string };
      try {
        const sessionId = await api.restore(JSON.parse(snapshot));
        return ok(JSON.stringify({ sessionId }));
      } catch (e) {
        return err(`Failed to restore snapshot: ${(e as Error).message}`);
      }
    }
    case 'terminal_close': {
      const { sessionId } = args as { sessionId: string };
      try {
        await api.destroySession(sessionId);
        return ok(`Closed session ${sessionId}`);
      } catch (e) {
        return err((e as Error).message);
      }
    }
    case 'workspace_create': {
      const { name } = args as { name: string };
      try {
        return ok(JSON.stringify({ workspaceId: api.createWorkspace(name) }));
      } catch (e) {
        return err((e as Error).message);
      }
    }
    case 'workspace_add': {
      const { workspaceId, sessionId } = args as { workspaceId: string; sessionId: string };
      try {
        api.addToWorkspace(workspaceId, sessionId);
        return ok(`Added session ${sessionId} to workspace ${workspaceId}`);
      } catch (e) {
        return err((e as Error).message);
      }
    }
    case 'workspace_remove': {
      const { workspaceId, sessionId } = args as { workspaceId: string; sessionId: string };
      try {
        api.removeFromWorkspace(workspaceId, sessionId);
        return ok(`Removed session ${sessionId} from workspace ${workspaceId}`);
      } catch (e) {
        return err((e as Error).message);
      }
    }
    case 'workspace_list':
      return ok(JSON.stringify(api.listWorkspaces(), null, 2));
    case 'workspace_run': {
      const { workspaceId, command } = args as { workspaceId: string; command: string };
      try {
        const results = await api.runInWorkspace(workspaceId, command, 'ai');
        return ok(JSON.stringify(results, null, 2));
      } catch (e) {
        return err((e as Error).message);
      }
    }
    case 'workspace_status': {
      const { workspaceId } = args as { workspaceId: string };
      try {
        return ok(JSON.stringify(api.getWorkspaceStatus(workspaceId), null, 2));
      } catch (e) {
        return err((e as Error).message);
      }
    }
    default:
      return err(`Unknown tool: ${name}`);
  }
}
