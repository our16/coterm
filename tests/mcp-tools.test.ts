import { describe, expect, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { CoTermMcpServer } from '../src/mcp/server.js';
import { SessionAPI } from '../src/api/session-api.js';
import { SessionManager } from '../src/core/session-manager.js';
import { MockPty } from './helpers/mock-pty.js';
import { InMemoryTransport } from './helpers/in-memory-transport.js';

class DelayedPromptPty extends MockPty {
  async write(data: string): Promise<void> {
    await super.write(data);
    setTimeout(() => this.emitOutput('PS C:\\proj>'), 10);
  }
}

const TOOL_COUNT = 17;

async function setup(ptyFactory: () => MockPty = () => new MockPty()) {
  const api = new SessionAPI({
    manager: new SessionManager(),
    defaultShell: 'powershell.exe',
    adapterFactory: ptyFactory,
  });
  const mcp = new CoTermMcpServer(api);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.1' });
  await Promise.all([client.connect(clientTransport), mcp.server.connect(serverTransport)]);
  return { api, mcp, client };
}

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content.map((c) => c.text ?? '').join('');
}

describe('CoTermMcpServer tools', () => {
  test('registers the full terminal tool suite', async () => {
    const { client } = await setup();
    const tools = await client.listTools();
    expect(tools.tools).toHaveLength(TOOL_COUNT);
    const names = tools.tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        'terminal_attach',
        'terminal_close',
        'terminal_create',
        'terminal_detach',
        'terminal_history',
        'terminal_interrupt',
        'terminal_list',
        'terminal_read',
        'terminal_replay',
        'terminal_recording',
        'terminal_restore',
        'terminal_resize',
        'terminal_run',
        'terminal_snapshot',
        'terminal_status',
        'terminal_wait_prompt',
        'terminal_write',
      ].sort(),
    );
  });

  test('terminal_list returns empty initially', async () => {
    const { client } = await setup();
    const result = await client.callTool({ name: 'terminal_list', arguments: {} });
    expect(textOf(result)).toBe('[]');
  });

  test('terminal_create then terminal_list', async () => {
    const { client } = await setup();
    const created = await client.callTool({ name: 'terminal_create', arguments: { name: 'proj' } });
    const { sessionId } = JSON.parse(textOf(created));
    expect(sessionId).toBeTruthy();

    const listed = await client.callTool({ name: 'terminal_list', arguments: {} });
    const sessions = JSON.parse(textOf(listed));
    expect(sessions).toHaveLength(1);
    expect(sessions[0].name).toBe('proj');
    expect(sessions[0].state).toBe('running');
  });

  test('terminal_write forwards input to PTY', async () => {
    const { api, client } = await setup();
    const id = await api.createSession({ id: 'write-test' });
    const session = api.getSessionManager().getSession(id);
    const pty = session?.pty as MockPty;

    const result = await client.callTool({ name: 'terminal_write', arguments: { sessionId: id, data: 'echo hi\r' } });
    expect(textOf(result)).toContain('Wrote');
    expect(pty.written).toContain('echo hi\r');
  });

  test('terminal_read returns captured output', async () => {
    const { api, client } = await setup();
    const id = await api.createSession({ id: 'read-test' });
    const session = api.getSessionManager().getSession(id);
    (session?.pty as MockPty).emitOutput('hello world\n');

    const result = await client.callTool({ name: 'terminal_read', arguments: { sessionId: id, lines: 10 } });
    expect(textOf(result)).toContain('hello world');
  });

  test('terminal_run writes command and waits for prompt', async () => {
    const { api, client } = await setup(() => new DelayedPromptPty());
    const id = await api.createSession({ id: 'run-test' });
    const session = api.getSessionManager().getSession(id);
    const pty = session?.pty as MockPty;

    const result = await client.callTool({
      name: 'terminal_run',
      arguments: { sessionId: id, command: 'git status', timeout: 2000 },
    });
    expect(textOf(result)).toContain('Prompt detected');
    expect(pty.written).toContain('git status\r');
  });

  test('terminal_resize forwards dimensions', async () => {
    const { api, client } = await setup();
    const id = await api.createSession({ id: 'resize-test' });
    const session = api.getSessionManager().getSession(id);
    const pty = session?.pty as MockPty;

    const result = await client.callTool({ name: 'terminal_resize', arguments: { sessionId: id, cols: 100, rows: 40 } });
    expect(textOf(result)).toContain('100x40');
    expect(pty.resized).toEqual([{ cols: 100, rows: 40 }]);
  });

  test('terminal_interrupt sends Ctrl+C', async () => {
    const { api, client } = await setup();
    const id = await api.createSession({ id: 'int-test' });
    const session = api.getSessionManager().getSession(id);
    const pty = session?.pty as MockPty;

    const result = await client.callTool({ name: 'terminal_interrupt', arguments: { sessionId: id } });
    expect(textOf(result)).toContain('Interrupted');
    expect(pty.written).toContain('\x03');
  });

  test('terminal_attach / detach flips ownership', async () => {
    const { api, client } = await setup();
    const id = await api.createSession({ id: 'owner-test' });
    await client.callTool({ name: 'terminal_attach', arguments: { sessionId: id } });
    expect(api.getSession(id).owner).toBe('ai');
    await client.callTool({ name: 'terminal_detach', arguments: { sessionId: id } });
    expect(api.getSession(id).owner).toBe('human');
  });

  test('terminal_close removes the session', async () => {
    const { api, client } = await setup();
    const id = await api.createSession({ id: 'close-test' });
    const result = await client.callTool({ name: 'terminal_close', arguments: { sessionId: id } });
    expect(textOf(result)).toContain('Closed');
    expect(api.listSessions()).toHaveLength(0);
  });

  test('terminal_status returns structured intelligence', async () => {
    const { api, client } = await setup();
    const id = await api.createSession({ id: 'status-test', cwd: 'C:\\proj' });
    const session = api.getSessionManager().getSession(id);
    const pty = session?.pty as MockPty;

    await api.runCommand(id, 'git status', 'ai');
    pty.emitOutput('\x1b[?1049h'); // simulate vim
    pty.emitOutput('On branch main\r\n');
    pty.emitOutput('PS C:\\proj>');

    const result = await client.callTool({ name: 'terminal_status', arguments: { sessionId: id } });
    const status = JSON.parse(textOf(result));
    expect(status.cwd).toBe('C:\\proj');
    expect(status.state).toBe('running');
    expect(status.fullScreenApp).toBe(true);
    expect(status.commands.length).toBeGreaterThanOrEqual(1);
    expect(status.lastCommand.command).toBe('git status');
    expect(status.lastCommand.error).toBe(false);
    expect(status.currentCommand).toBeNull();
  });

  test('terminal_history returns recorded command graph', async () => {
    const { api, client } = await setup();
    const id = await api.createSession({ id: 'history-test' });
    const session = api.getSessionManager().getSession(id);
    const pty = session?.pty as MockPty;

    await api.runCommand(id, 'git pull', 'ai');
    pty.emitOutput('Already up to date.\r\nPS C:\\proj>');
    await api.runCommand(id, 'pytest', 'ai');
    pty.emitOutput('2 passed\r\nPS C:\\proj>');

    const result = await client.callTool({ name: 'terminal_history', arguments: { sessionId: id } });
    const history = JSON.parse(textOf(result));
    expect(history.map((c: { command: string }) => c.command)).toEqual(['git pull', 'pytest']);
    expect(history.every((c: { requester: string }) => c.requester === 'ai')).toBe(true);
  });

  test('terminal_create supports ssh connector', async () => {
    const { api, client } = await setup();
    const created = await client.callTool({
      name: 'terminal_create',
      arguments: { connector: { type: 'ssh', host: 'jump.example.com', user: 'admin', port: 2222 } },
    });
    const { sessionId } = JSON.parse(textOf(created));
    const session = api.getSessionManager().getSession(sessionId);
    expect(session?.config.shell).toBe('ssh');
    expect(session?.config.shellArgs).toEqual(['-p', '2222', 'admin@jump.example.com']);
  });

  test('terminal_attach with agent ids enables multi-AI sharing', async () => {
    const { api, client } = await setup();
    const id = await api.createSession({ id: 'multi-ai' });

    await client.callTool({ name: 'terminal_attach', arguments: { sessionId: id, agent: 'deploy-agent' } });
    await client.callTool({ name: 'terminal_attach', arguments: { sessionId: id, agent: 'monitor-agent' } });
    expect(api.getParticipants(id)).toEqual(['deploy-agent', 'monitor-agent']);

    await client.callTool({ name: 'terminal_detach', arguments: { sessionId: id, agent: 'deploy-agent' } });
    expect(api.getParticipants(id)).toEqual(['monitor-agent']);
    expect(api.getSession(id).owner).toBe('ai');

    await client.callTool({ name: 'terminal_detach', arguments: { sessionId: id, agent: 'monitor-agent' } });
    expect(api.getParticipants(id)).toEqual([]);
    expect(api.getSession(id).owner).toBe('human');
  });

  test('terminal_recording and terminal_replay capture events', async () => {
    const { api, client } = await setup();
    const id = await api.createSession({ id: 'rec-mcp' });
    const session = api.getSessionManager().getSession(id);
    const pty = session?.pty as MockPty;

    await client.callTool({ name: 'terminal_recording', arguments: { sessionId: id, action: 'start' } });
    pty.emitOutput('recording this\n');
    const replay = await client.callTool({ name: 'terminal_replay', arguments: { sessionId: id } });
    expect(textOf(replay)).toContain('recording this');

    await client.callTool({ name: 'terminal_recording', arguments: { sessionId: id, action: 'stop' } });
    expect(api.isRecording(id)).toBe(false);
  });

  test('terminal_snapshot and terminal_restore round-trip', async () => {
    const { api, client } = await setup();
    const id = await api.createSession({ id: 'snap-mcp', cwd: 'C:\\proj' });
    const session = api.getSessionManager().getSession(id);
    const pty = session?.pty as MockPty;

    await api.runCommand(id, 'git status', 'ai');
    pty.emitOutput('On branch main\r\n');
    pty.emitOutput('PS C:\\proj>');

    const snapResult = await client.callTool({ name: 'terminal_snapshot', arguments: { sessionId: id } });
    const snapshot = textOf(snapResult);

    await client.callTool({ name: 'terminal_close', arguments: { sessionId: id } });

    const restoreResult = await client.callTool({ name: 'terminal_restore', arguments: { snapshot } });
    const { sessionId: newId } = JSON.parse(textOf(restoreResult));
    const restored = api.getIntelligence(newId);
    expect(restored.lastCommand?.command).toBe('git status');
    expect(restored.cwd).toBe('C:\\proj');
  });

  test('missing session returns isError', async () => {
    const { client } = await setup();
    const result = await client.callTool({ name: 'terminal_read', arguments: { sessionId: 'nope' } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('not found');
  });
});
