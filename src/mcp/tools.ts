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
      description: 'Create a new terminal session (spawns a shell via PTY). Returns the session ID.',
      inputSchema: {
        name: z.string().optional().describe('Optional session name'),
        shell: z.string().optional().describe('Shell executable, e.g. powershell.exe, cmd.exe, /bin/bash'),
        shellArgs: z.array(z.string()).optional().describe('Shell arguments'),
        cwd: z.string().optional().describe('Working directory for the session'),
        cols: z.number().int().positive().optional().describe('Initial terminal columns'),
        rows: z.number().int().positive().optional().describe('Initial terminal rows'),
      },
    },
    async ({ name, shell, shellArgs, cwd, cols, rows }) => {
      try {
        const sessionId = await api.createSession({ name, shell, shellArgs, cwd, cols, rows });
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
      description: 'Attach as AI collaborator to a session, granting write access through the input scheduler.',
      inputSchema: {
        sessionId: z.string().describe('Session ID to attach to'),
      },
    },
    async ({ sessionId }) => {
      try {
        api.attach(sessionId);
        return toolText(`Attached AI to session ${sessionId}`);
      } catch (err) {
        return toolError((err as Error).message);
      }
    },
  );

  server.registerTool(
    'terminal_detach',
    {
      title: 'Detach from Session',
      description: 'Detach the AI from a session, returning ownership to the human.',
      inputSchema: {
        sessionId: z.string().describe('Session ID to detach from'),
      },
    },
    async ({ sessionId }) => {
      try {
        api.detach(sessionId);
        return toolText(`Detached AI from session ${sessionId}`);
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
        return toolText(JSON.stringify(intelligence, null, 2));
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
