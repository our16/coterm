import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SessionAPI } from '../api/session-api.js';

export function toolText(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

export function toolError(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true };
}

export function registerTerminalTools(server: McpServer, api: SessionAPI): void {
  server.registerTool(
    'terminal_create',
    {
      title: 'Create Terminal Session',
      description:
        'Create a new terminal session. Use connector.type to attach to a remote/container target: ' +
        'local (default), ssh (host/user/port/identity), wsl (distro), docker (container). Spawns the shell via PTY.',
      inputSchema: {
        name: z.string().optional().describe('Optional session name'),
        shell: z.string().optional().describe('Shell executable, e.g. powershell.exe, cmd.exe, /bin/bash'),
        shellArgs: z.array(z.string()).optional().describe('Shell arguments'),
        cwd: z.string().optional().describe('Working directory for the session'),
        cols: z.number().int().positive().optional().describe('Initial terminal columns'),
        rows: z.number().int().positive().optional().describe('Initial terminal rows'),
        connector: z.object({
          type: z.enum(['local', 'ssh', 'wsl', 'docker', 'kubernetes', 'serial']).describe('Connector type'),
          host: z.string().optional().describe('Remote host (ssh)'),
          port: z.number().int().positive().optional().describe('Remote port (ssh, default 22)'),
          user: z.string().optional().describe('Remote user (ssh)'),
          identity: z.string().optional().describe('Identity file path (ssh)'),
          distro: z.string().optional().describe('WSL distribution name (wsl)'),
          container: z.string().optional().describe('Container name/id (docker)'),
        }).optional().describe('Connector configuration'),
      },
    },
    async ({ name, shell, shellArgs, cwd, cols, rows, connector }) => {
      try {
        const sessionId = await api.createSession({ name, shell, shellArgs, cwd, cols, rows, connector });
        return toolText(JSON.stringify({ sessionId }));
      } catch (err) {
        return toolError(`Failed to create session: ${(err as Error).message}`);
      }
    },
  );

  server.registerTool(
    'terminal_list',
    {
      title: 'List Terminal Sessions',
      description: 'List all active terminal sessions with their state, shell, and working directory.',
    },
    async () => {
      return toolText(JSON.stringify(api.listSessions(), null, 2));
    },
  );

  server.registerTool(
    'terminal_attach',
    {
      title: 'Attach to Session',
      description:
        'Attach as an AI collaborator to a session, granting write access through the input scheduler. ' +
        'Multiple AIs can attach with distinct agent ids to share one session.',
      inputSchema: {
        sessionId: z.string().describe('Session ID to attach to'),
        agent: z.string().optional().describe('Agent identifier (default: anonymous)'),
      },
    },
    async ({ sessionId, agent }) => {
      try {
        api.attach(sessionId, agent);
        return toolText(`Attached AI${agent ? ` ${agent}` : ''} to session ${sessionId}`);
      } catch (err) {
        return toolError((err as Error).message);
      }
    },
  );

  server.registerTool(
    'terminal_detach',
    {
      title: 'Detach from Session',
      description: 'Detach the AI from a session, returning ownership to the human when no AI remains.',
      inputSchema: {
        sessionId: z.string().describe('Session ID to detach from'),
        agent: z.string().optional().describe('Agent identifier to detach'),
      },
    },
    async ({ sessionId, agent }) => {
      try {
        api.detach(sessionId, agent);
        return toolText(`Detached AI${agent ? ` ${agent}` : ''} from session ${sessionId}`);
      } catch (err) {
        return toolError((err as Error).message);
      }
    },
  );

  server.registerTool(
    'terminal_read',
    {
      title: 'Read Session Output',
      description: 'Read the last N lines of output from a session (ANSI codes stripped).',
      inputSchema: {
        sessionId: z.string().describe('Session ID to read from'),
        lines: z.number().int().positive().max(500).optional().describe('Number of lines to read (default 50)'),
      },
    },
    async ({ sessionId, lines }) => {
      try {
        const output = api.readText(sessionId, lines ?? 50);
        return toolText(output || '(no output yet)');
      } catch (err) {
        return toolError((err as Error).message);
      }
    },
  );

  server.registerTool(
    'terminal_write',
    {
      title: 'Write to Session',
      description: 'Write raw input to a session through the input scheduler. Human input always has priority.',
      inputSchema: {
        sessionId: z.string().describe('Session ID to write to'),
        data: z.string().describe('Raw input to write (use \\r for Enter, \\x03 for Ctrl+C)'),
      },
    },
    async ({ sessionId, data }) => {
      try {
        await api.write(sessionId, data, 'ai');
        return toolText(`Wrote ${data.length} chars to session ${sessionId}`);
      } catch (err) {
        return toolError((err as Error).message);
      }
    },
  );

  server.registerTool(
    'terminal_run',
    {
      title: 'Run Command',
      description: 'Write a command followed by Enter to a session and wait for the next prompt.',
      inputSchema: {
        sessionId: z.string().describe('Session ID to run the command in'),
        command: z.string().describe('Command to execute'),
        timeout: z.number().int().positive().optional().describe('Max ms to wait for the prompt (default 30000)'),
      },
    },
    async ({ sessionId, command, timeout }) => {
      try {
        await api.runCommand(sessionId, command, 'ai');
        const prompt = await api.waitForPrompt(sessionId, timeout ?? 30000);
        return toolText(`Command finished. Prompt detected: ${JSON.stringify(prompt)}`);
      } catch (err) {
        return toolError(`Command did not complete: ${(err as Error).message}`);
      }
    },
  );

  server.registerTool(
    'terminal_wait_prompt',
    {
      title: 'Wait for Prompt',
      description: 'Wait for the next shell prompt, signalling the current command has finished.',
      inputSchema: {
        sessionId: z.string().describe('Session ID to wait on'),
        timeout: z.number().int().positive().optional().describe('Max ms to wait (default 30000)'),
      },
    },
    async ({ sessionId, timeout }) => {
      try {
        const prompt = await api.waitForPrompt(sessionId, timeout ?? 30000);
        return toolText(`Prompt detected: ${JSON.stringify(prompt)}`);
      } catch (err) {
        return toolError((err as Error).message);
      }
    },
  );

  server.registerTool(
    'terminal_resize',
    {
      title: 'Resize Session',
      description: 'Resize the PTY dimensions of a session.',
      inputSchema: {
        sessionId: z.string().describe('Session ID to resize'),
        cols: z.number().int().positive().describe('New column count'),
        rows: z.number().int().positive().describe('New row count'),
      },
    },
    async ({ sessionId, cols, rows }) => {
      try {
        api.resize(sessionId, cols, rows);
        return toolText(`Resized session ${sessionId} to ${cols}x${rows}`);
      } catch (err) {
        return toolError((err as Error).message);
      }
    },
  );

  server.registerTool(
    'terminal_interrupt',
    {
      title: 'Interrupt Session',
      description: 'Send Ctrl+C to a session to interrupt the running command.',
      inputSchema: {
        sessionId: z.string().describe('Session ID to interrupt'),
      },
    },
    async ({ sessionId }) => {
      try {
        api.interrupt(sessionId, 'ai');
        return toolText(`Interrupted session ${sessionId}`);
      } catch (err) {
        return toolError((err as Error).message);
      }
    },
  );

  server.registerTool(
    'terminal_status',
    {
      title: 'Session Intelligence Status',
      description:
        'Get structured session intelligence: current directory, shell state, running full-screen app, ' +
        'detected toolchains (node/python/git/docker...), and the command graph (recent commands with duration and errors).',
      inputSchema: {
        sessionId: z.string().describe('Session ID to inspect'),
      },
    },
    async ({ sessionId }) => {
      try {
        const intelligence = api.getIntelligence(sessionId);
        const info = api.getSession(sessionId);
        const presence = api.getPresence(sessionId);
        const participants = api.getParticipants(sessionId);
        return toolText(JSON.stringify({ ...intelligence, presence, participants, info }, null, 2));
      } catch (err) {
        return toolError((err as Error).message);
      }
    },
  );

  server.registerTool(
    'terminal_history',
    {
      title: 'Command History',
      description: 'Return the recorded command graph for a session (command, requester, duration, error status, output preview).',
      inputSchema: {
        sessionId: z.string().describe('Session ID to inspect'),
        limit: z.number().int().positive().max(200).optional().describe('Max commands to return (default 50)'),
      },
    },
    async ({ sessionId, limit }) => {
      try {
        const history = api.getHistory(sessionId);
        const slice = history.slice(-(limit ?? 50));
        return toolText(JSON.stringify(slice, null, 2));
      } catch (err) {
        return toolError((err as Error).message);
      }
    },
  );

  server.registerTool(
    'terminal_recording',
    {
      title: 'Session Recording Control',
      description: 'Start or stop recording a session. While recording, all output/prompt/command events are captured with timestamps.',
      inputSchema: {
        sessionId: z.string().describe('Session ID to record'),
        action: z.enum(['start', 'stop']).describe('start or stop recording'),
      },
    },
    async ({ sessionId, action }) => {
      try {
        if (action === 'start') {
          api.startRecording(sessionId);
          return toolText(`Recording started for session ${sessionId}`);
        }
        api.stopRecording(sessionId);
        return toolText(`Recording stopped for session ${sessionId}`);
      } catch (err) {
        return toolError((err as Error).message);
      }
    },
  );

  server.registerTool(
    'terminal_replay',
    {
      title: 'Replay Session Recording',
      description: 'Return the recorded events (JSONL) for a session: output, prompts, commands, attach/detach, interrupts.',
      inputSchema: {
        sessionId: z.string().describe('Session ID to replay'),
        format: z.enum(['jsonl', 'json']).optional().describe('Output format (default jsonl)'),
      },
    },
    async ({ sessionId, format }) => {
      try {
        const body = (format ?? 'jsonl') === 'jsonl' ? api.getRecordingJsonl(sessionId) : JSON.stringify(api.getRecording(sessionId), null, 2);
        return toolText(body || '(no recorded events)');
      } catch (err) {
        return toolError((err as Error).message);
      }
    },
  );

  server.registerTool(
    'terminal_snapshot',
    {
      title: 'Snapshot Session',
      description:
        'Capture a full session snapshot (config, screen buffer, prompt, command history, cwd, toolchains). ' +
        'Use terminal_restore to recreate the session from the snapshot.',
      inputSchema: {
        sessionId: z.string().describe('Session ID to snapshot'),
      },
    },
    async ({ sessionId }) => {
      try {
        const snapshot = api.snapshot(sessionId);
        return toolText(JSON.stringify(snapshot));
      } catch (err) {
        return toolError((err as Error).message);
      }
    },
  );

  server.registerTool(
    'terminal_restore',
    {
      title: 'Restore Session Snapshot',
      description: 'Restore a previously captured session snapshot: creates a new session with the same config, screen, and command history.',
      inputSchema: {
        snapshot: z.string().describe('The session snapshot JSON (as returned by terminal_snapshot)'),
      },
    },
    async ({ snapshot }) => {
      try {
        const parsed = JSON.parse(snapshot);
        const sessionId = await api.restore(parsed);
        return toolText(JSON.stringify({ sessionId }));
      } catch (err) {
        return toolError(`Failed to restore snapshot: ${(err as Error).message}`);
      }
    },
  );

  server.registerTool(
    'workspace_create',
    {
      title: 'Create Workspace',
      description: 'Create a named workspace that groups multiple sessions (e.g. a deploy workspace with Linux/Redis/MySQL/K8s).',
      inputSchema: {
        name: z.string().describe('Workspace name'),
      },
    },
    async ({ name }) => {
      try {
        const workspaceId = api.createWorkspace(name);
        return toolText(JSON.stringify({ workspaceId }));
      } catch (err) {
        return toolError((err as Error).message);
      }
    },
  );

  server.registerTool(
    'workspace_add',
    {
      title: 'Add Session to Workspace',
      description: 'Add an existing session to a workspace.',
      inputSchema: {
        workspaceId: z.string().describe('Workspace ID'),
        sessionId: z.string().describe('Session ID to add'),
      },
    },
    async ({ workspaceId, sessionId }) => {
      try {
        api.addToWorkspace(workspaceId, sessionId);
        return toolText(`Added session ${sessionId} to workspace ${workspaceId}`);
      } catch (err) {
        return toolError((err as Error).message);
      }
    },
  );

  server.registerTool(
    'workspace_remove',
    {
      title: 'Remove Session from Workspace',
      description: 'Remove a session from a workspace.',
      inputSchema: {
        workspaceId: z.string().describe('Workspace ID'),
        sessionId: z.string().describe('Session ID to remove'),
      },
    },
    async ({ workspaceId, sessionId }) => {
      try {
        api.removeFromWorkspace(workspaceId, sessionId);
        return toolText(`Removed session ${sessionId} from workspace ${workspaceId}`);
      } catch (err) {
        return toolError((err as Error).message);
      }
    },
  );

  server.registerTool(
    'workspace_list',
    {
      title: 'List Workspaces',
      description: 'List all workspaces with their member session IDs.',
    },
    async () => {
      return toolText(JSON.stringify(api.listWorkspaces(), null, 2));
    },
  );

  server.registerTool(
    'workspace_run',
    {
      title: 'Run Command in Workspace',
      description: 'Run a command in every session of a workspace (in parallel).',
      inputSchema: {
        workspaceId: z.string().describe('Workspace ID'),
        command: z.string().describe('Command to run in each session'),
      },
    },
    async ({ workspaceId, command }) => {
      try {
        const results = await api.runInWorkspace(workspaceId, command, 'ai');
        return toolText(JSON.stringify(results, null, 2));
      } catch (err) {
        return toolError((err as Error).message);
      }
    },
  );

  server.registerTool(
    'workspace_status',
    {
      title: 'Workspace Status',
      description: 'Show state/presence/cwd of every session in a workspace.',
      inputSchema: {
        workspaceId: z.string().describe('Workspace ID'),
      },
    },
    async ({ workspaceId }) => {
      try {
        return toolText(JSON.stringify(api.getWorkspaceStatus(workspaceId), null, 2));
      } catch (err) {
        return toolError((err as Error).message);
      }
    },
  );

  server.registerTool(
    'terminal_close',
    {
      title: 'Close Session',
      description: 'Close and destroy a terminal session, terminating its shell process.',
      inputSchema: {
        sessionId: z.string().describe('Session ID to close'),
      },
    },
    async ({ sessionId }) => {
      try {
        await api.destroySession(sessionId);
        return toolText(`Closed session ${sessionId}`);
      } catch (err) {
        return toolError((err as Error).message);
      }
    },
  );
}
