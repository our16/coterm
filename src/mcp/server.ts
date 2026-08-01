import { McpServer as McpServerSdk } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerTerminalTools } from './tools.js';
import { sessionAPI, type SessionAPI } from '../api/session-api.js';
import { logger } from '../utils/logger.js';

export function buildMcpSdk(api: SessionAPI): McpServerSdk {
  const server = new McpServerSdk(
    {
      name: 'coterm',
      version: '0.3.0',
    },
    {
      capabilities: {
        tools: {},
      },
      instructions:
        'CoTerm AI Session Runtime. Manage PTY-backed terminal sessions. ' +
        'Use terminal_create to spawn a session, terminal_run to execute commands, ' +
        'terminal_read to inspect output, and terminal_wait_prompt to detect command completion. ' +
        'Human input always has priority over AI input.',
    },
  );
  registerTerminalTools(server, api);
  return server;
}

export class CoTermMcpServer {
  readonly server: McpServerSdk;
  readonly api: SessionAPI;

  constructor(api: SessionAPI = sessionAPI) {
    this.api = api;
    this.server = buildMcpSdk(api);
  }

  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    logger.info('CoTerm MCP server connected over stdio');
  }

  async stop(): Promise<void> {
    await this.server.close();
  }
}

export async function startMcpServer(api: SessionAPI = sessionAPI): Promise<CoTermMcpServer> {
  const mcp = new CoTermMcpServer(api);
  await mcp.start();
  return mcp;
}

export default CoTermMcpServer;
