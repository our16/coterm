import * as http from 'node:http';
import { getMcpHost, getMcpPort, loadConfig, readActiveState } from '../config.js';

export interface DaemonResult {
  text: string;
  isError: boolean;
}

export function getDaemonUrl(): string {
  const config = loadConfig();
  return `http://${getMcpHost()}:${getMcpPort(config)}/mcp`;
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
  const { status, data } = await postJson(getMcpHost(), getMcpPort(config), { tool, args });
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

export interface StreamChunk {
  text: string;
  offset: number;
}

/**
 * Subscribe to a session's live output over SSE. Calls `onChunk` for every
 * piece of raw PTY output (including the seed from the given byte offset).
 * Returns an unsubscribe function. `onEnd` is called on error/close.
 */
export function streamSessionOutput(
  sessionId: string,
  from: number,
  onChunk: (chunk: StreamChunk) => void,
  onEnd: (err?: Error) => void,
): () => void {
  const config = loadConfig();
  const host = getMcpHost();
  const port = getMcpPort(config);
  let closed = false;
  let buffer = '';

  const req = http.request(
    {
      host,
      port,
      path: `/stream?sessionId=${encodeURIComponent(sessionId)}&from=${from}`,
      method: 'GET',
      headers: { Accept: 'text/event-stream' },
    },
    (res) => {
      if (res.statusCode !== 200) {
        onEnd(new Error(`Stream failed (HTTP ${res.statusCode})`));
        return;
      }
      res.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        let idx: number;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const rawEvent = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const lines = rawEvent.split('\n');
          const dataLine = lines.find((l) => l.startsWith('data: '));
          if (!dataLine) continue;
          try {
            onChunk(JSON.parse(dataLine.slice(6)) as StreamChunk);
          } catch {
            // skip malformed events
          }
        }
      });
      res.on('end', () => !closed && onEnd());
      res.on('error', (err) => !closed && onEnd(err));
    },
  );
  req.on('error', (err) => !closed && onEnd(err));
  req.end();

  return () => {
    closed = true;
    req.destroy();
  };
}


/** Returns the running daemon's version, or null if it's stale/unreachable. */
export async function getDaemonVersion(): Promise<string | null> {
  try {
    const { text, isError } = await callDaemon('system_info');
    if (isError) return null;
    const parsed = JSON.parse(text) as { version?: string };
    return parsed.version ?? null;
  } catch {
    return null;
  }
}

/** Gracefully asks the running daemon to exit (best-effort). */
export async function stopDaemonViaCli(): Promise<void> {
  try {
    await callDaemon('system_stop');
  } catch {
    // daemon may already be gone
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

  // Prefer this window's own session (recorded in its per-window state file).
  const windowPid = process.ppid ?? process.pid;
  const state = readActiveState(windowPid);
  if (state?.sessionId) {
    const own = sessions.find((s) => s.id === state.sessionId && s.state === 'running');
    if (own) return own.id;
  }

  const running = sessions.find((s) => s.state === 'running');
  if (!running) {
    throw new Error('No running session in the CoTerm environment. Create one with: coterm create');
  }
  return running.id;
}
