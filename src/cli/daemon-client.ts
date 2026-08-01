import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { getMcpHost, getMcpPort, loadConfig } from '../config.js';

export interface DaemonResult {
  text: string;
  isError: boolean;
}

export function getDaemonUrl(): string {
  const config = loadConfig();
  return `http://${getMcpHost(config)}:${getMcpPort(config)}/mcp`;
}

export async function callDaemon(tool: string, args: Record<string, unknown> = {}): Promise<DaemonResult> {
  const transport = new StreamableHTTPClientTransport(new URL(getDaemonUrl()), {
    reconnectionOptions: {
      maxRetries: 0,
      initialReconnectionDelay: 0,
      maxReconnectionDelay: 0,
      reconnectionDelayGrowFactor: 0,
    },
  });
  const client = new Client({ name: 'coterm-cli', version: '0.2.0' });
  try {
    await client.connect(transport);
    const result = await client.callTool({ name: tool, arguments: args });
    const content = result.content as Array<{ text?: string }>;
    const text = content.map((c) => c.text ?? '').join('');
    return { text, isError: !!result.isError };
  } finally {
    await client.close().catch(() => {});
  }
}

export async function daemonAlive(): Promise<boolean> {
  try {
    await callDaemon('terminal_list');
    return true;
  } catch {
    return false;
  }
}

export async function waitForDaemon(timeoutMs = 10000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await daemonAlive()) return true;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
}

export interface SessionInfoFromDaemon {
  id: string;
  name: string;
  state: string;
  [key: string]: unknown;
}

export async function listSessionsFromDaemon(): Promise<SessionInfoFromDaemon[]> {
  const { text } = await callDaemon('terminal_list');
  return JSON.parse(text) as SessionInfoFromDaemon[];
}

export async function resolveSession(sessionId?: string): Promise<string> {
  if (sessionId) return sessionId;
  const sessions = await listSessionsFromDaemon();
  const running = sessions.find((s) => s.state === 'running');
  if (!running) {
    throw new Error('No running session in the CoTerm environment. Create one with: coterm create');
  }
  return running.id;
}
