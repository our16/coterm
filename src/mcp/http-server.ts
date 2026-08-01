import * as http from 'node:http';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { McpServer as McpServerSdk } from '@modelcontextprotocol/sdk/server/mcp.js';
import { buildMcpSdk } from './server.js';
import { executeTool } from './executor.js';
import { sessionAPI, type SessionAPI } from '../api/session-api.js';
import { cleanupOrphanedSessions } from '../cleanup.js';
import { logger } from '../utils/logger.js';
import { eventBus } from '../core/event-bus.js';
import { DEFAULT_MCP_HOST, DEFAULT_MCP_PORT } from '../config.js';

export interface HttpMcpServerOptions {
  port?: number;
  host?: string;
  path?: string;
}

export interface HttpMcpServerHandle {
  server: http.Server;
  url: string;
  port: number;
  stop(): Promise<void>;
}

interface McpSessionEntry {
  transport: StreamableHTTPServerTransport;
  server: McpServerSdk;
}

function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve(undefined);
      }
    });
    req.on('error', () => resolve(undefined));
  });
}

export async function startHttpMcpServer(
  api: SessionAPI = sessionAPI,
  options: HttpMcpServerOptions = {},
): Promise<HttpMcpServerHandle> {
  const port = options.port ?? DEFAULT_MCP_PORT;
  const host = options.host ?? DEFAULT_MCP_HOST;
  const path = options.path ?? '/mcp';

  const sessions = new Map<string, McpSessionEntry>();

  const httpServer = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Mcp-Session-Id, Authorization, Last-Event-ID');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      if (url.pathname !== path) {
        // Local CLI endpoint (plain JSON over node:http — no undici/fetch needed)
        if (url.pathname === '/cli' && req.method === 'POST') {
          // Opportunistically close orphaned sessions (windows that exited).
          await cleanupOrphanedSessions(api).catch(() => {});
          const body = (await readJsonBody(req)) as { tool?: string; args?: Record<string, unknown> } | undefined;
          if (!body?.tool) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'missing tool' }));
            return;
          }
          try {
            const result = await executeTool(api, body.tool, body.args ?? {});
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, text: result.text, isError: result.isError ?? false }));
          } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: (err as Error).message }));
          }
          return;
        }

        // Live output stream (SSE) for terminal attach/`coterm run` views.
        if (url.pathname === '/stream' && req.method === 'GET') {
          const sessionId = url.searchParams.get('sessionId');
          const from = Number(url.searchParams.get('from') ?? '0') || 0;
          if (!sessionId) {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('missing sessionId');
            return;
          }
          try {
            const session = api.getSessionManager().getSession(sessionId);
            if (!session) throw new Error(`Session ${sessionId} not found`);

            res.writeHead(200, {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              Connection: 'keep-alive',
              'X-Accel-Buffering': 'no',
            });
            res.write(': connected\n\n');
            res.flushHeaders?.();

            // Seed from the given byte offset so we don't replay history.
            const seed = session.getRawOutput(from);
            if (seed.text) {
              res.write(`data: ${JSON.stringify({ text: seed.text, offset: seed.offset })}\n\n`);
            }

            const unsubscribe = eventBus.on('session:output', (event) => {
              if (event.type === 'session:output' && event.sessionId === sessionId) {
                const s = session.getRawOutput(0);
                res.write(`data: ${JSON.stringify({ text: event.data, offset: s.offset })}\n\n`);
              }
            });

            const heartbeat = setInterval(() => {
              try {
                res.write(': ping\n\n');
              } catch {
                clearInterval(heartbeat);
                unsubscribe();
              }
            }, 15000);
            heartbeat.unref?.();

            req.on('close', () => {
              clearInterval(heartbeat);
              unsubscribe();
            });
          } catch (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end((err as Error).message);
          }
          return;
        }

        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
      }

      const sessionId = req.headers['mcp-session-id'] as string | undefined;

      if (req.method === 'DELETE' && sessionId) {
        const entry = sessions.get(sessionId);
        if (entry) {
          await entry.transport.close();
          sessions.delete(sessionId);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      let entry = sessionId ? sessions.get(sessionId) : undefined;
      let isNew = false;

      if (!entry) {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
        });
        const server = buildMcpSdk(api);
        entry = { transport, server };
        isNew = true;
        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid) sessions.delete(sid);
        };
        await server.connect(transport);
      }

      let parsedBody: unknown;
      if (req.method === 'POST') {
        parsedBody = await readJsonBody(req);
      }

      await entry.transport.handleRequest(req, res, parsedBody);

      // The session id is only generated while handling the `initialize` request.
      // Register the entry afterwards so subsequent requests can be routed to it.
      if (isNew) {
        const sid = entry.transport.sessionId;
        if (sid && !sessions.has(sid)) {
          sessions.set(sid, entry);
        }
      }
    } catch (err) {
      logger.error({ err }, 'HTTP MCP request error');
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'internal server error' }));
      }
    }
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, host, () => resolve());
  });

  const actualPort = (httpServer.address() as { port: number }).port;
  const url = `http://${host}:${actualPort}${path}`;
  logger.info({ url }, 'CoTerm MCP server listening over HTTP');

  return {
    server: httpServer,
    url,
    port: actualPort,
    async stop() {
      for (const entry of sessions.values()) {
        try {
          await entry.transport.close();
        } catch {
          // ignore per-session close errors
        }
      }
      sessions.clear();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}

export default startHttpMcpServer;
