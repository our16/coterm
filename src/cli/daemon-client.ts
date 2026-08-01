import * as http from 'node:http';
import { getMcpHost, getMcpPort, loadConfig } from '../config.js';

export interface DaemonResult {
  text: string;
  isError: boolean;
}

export function getDaemonUrl(): string {
  const config = loadConfig();
  return `http://${getMcpHost(config)}:${getMcpPort(config)}/mcp`;
}

interface CliResponse {
  status: number;
  data: string;
}

function postJson(host: string, port: number, body: unknown): Promise<CliResponse> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        host,
        port,
        path: '/cli',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, data }));
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

export async function callDaemon(tool: string, args: Record<string, unknown> = {}): Promise<DaemonResult> {
  const config = loadConfig();
  const { status, data } = await postJson(getMcpHost(config), getMcpPort(config), { tool, args });
  if (status !== 200) {
    throw new Error(`Daemon request failed (HTTP ${status})`);
  }
  const parsed = JSON.parse(data) as { ok?: boolean; text?: string; isError?: boolean; error?: string };
  if (!parsed.ok) {
    throw new Error(parsed.error ?? 'daemon error');
  }
  return { text: parsed.text ?? '', isError: parsed.isError ?? false };
}

export async function daemonAlive(): Promise<boolean> {
  try {
    await callDaemon('terminal_list');
    return true;
  } catch {
    return false;
  }
}

export async function waitForDaemon(timeoutMs = 30000): Promise<boolean> {
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
