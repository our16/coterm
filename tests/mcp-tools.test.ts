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

const TOOL_COUNT = 11;

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
        'terminal_interrupt',
        'terminal_list',
        'terminal_read',
        'terminal_resize',
        'terminal_run',
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

  test('missing session returns isError', async () => {
    const { client } = await setup();
    const result = await client.callTool({ name: 'terminal_read', arguments: { sessionId: 'nope' } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('not found');
  });
});
