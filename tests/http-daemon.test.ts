import { describe, expect, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startHttpMcpServer } from '../src/mcp/http-server.js';
import { SessionAPI } from '../src/api/session-api.js';
import { SessionManager } from '../src/core/session-manager.js';
import { MockPty } from './helpers/mock-pty.js';

function makeApi() {
  return new SessionAPI({
    manager: new SessionManager(),
    adapterFactory: () => new MockPty(),
  });
}

async function connect(url: string, name: string) {
  const transport = new StreamableHTTPClientTransport(new URL(url));
  const client = new Client({ name, version: '0.0.1' });
  await client.connect(transport);
  return { client, transport };
}

describe('CoTerm HTTP daemon (single-process shared sessions)', () => {
  test('two clients share one session registry', async () => {
    const api = makeApi();
    const handle = await startHttpMcpServer(api, { port: 0 });
    const url = handle.url;

    const a = await connect(url, 'agent-a');
    const b = await connect(url, 'agent-b');

    // Agent A creates a session
    const created = await a.client.callTool({ name: 'terminal_create', arguments: { name: 'shared' } });
    const { sessionId } = JSON.parse(created.content[0].text);
    expect(sessionId).toBeTruthy();

    // Agent B sees the same session (shared registry)
    const listed = await b.client.callTool({ name: 'terminal_list', arguments: {} });
    const sessions = JSON.parse(listed.content[0].text);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe(sessionId);
    expect(sessions[0].name).toBe('shared');

    // Agent B can attach to Agent A's session
    await b.client.callTool({ name: 'terminal_attach', arguments: { sessionId, agent: 'agent-b' } });
    expect(api.getParticipants(sessionId)).toEqual(['agent-b']);

    await a.client.close();
    await b.client.close();
    await handle.stop();
  });

  test('each client gets an independent MCP session but shared sessions', async () => {
    const api = makeApi();
    const handle = await startHttpMcpServer(api, { port: 0 });

    const a = await connect(handle.url, 'agent-a');
    const b = await connect(handle.url, 'agent-b');

    const a1 = await a.client.listTools();
    const b1 = await b.client.listTools();
    expect(a1.tools).toHaveLength(23);
    expect(b1.tools).toHaveLength(23);

    await a.client.close();
    await b.client.close();
    await handle.stop();
  });

  test('shared session state propagates across clients', async () => {
    const api = makeApi();
    const handle = await startHttpMcpServer(api, { port: 0 });

    const a = await connect(handle.url, 'agent-a');
    const b = await connect(handle.url, 'agent-b');

    const created = await a.client.callTool({ name: 'terminal_create', arguments: { name: 'state-test' } });
    const { sessionId } = JSON.parse(created.content[0].text);

    // Agent A runs a command; emit output asynchronously so the prompt can arrive
    const session = api.getSessionManager().getSession(sessionId);
    const pty = session?.pty as MockPty;
    const runPromise = a.client.callTool({ name: 'terminal_run', arguments: { sessionId, command: 'echo shared-state', timeout: 5000 } });
    await new Promise((r) => setTimeout(r, 100));
    pty.emitOutput('shared-state\r\n');
    pty.emitOutput('PS C:\\proj>');
    await runPromise;

    // Agent B reads the output from the same session
    const read = await b.client.callTool({ name: 'terminal_read', arguments: { sessionId, lines: 10 } });
    expect(read.content[0].text).toContain('shared-state');

    await a.client.close();
    await b.client.close();
    await handle.stop();
  });
});
