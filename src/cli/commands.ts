import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { sessionAPI } from '../api/session-api.js';
import { startMcpServer, CoTermMcpServer } from '../mcp/server.js';
import { logger } from '../utils/logger.js';
import { getTempDir, isWindows } from '../utils/platform.js';

const PID_FILE = path.join(getTempDir(), 'coterm.pid');

export interface StartOptions {
  shell?: string;
  cwd?: string;
  name?: string;
  noMcp?: boolean;
}

export async function cmdStart(options: StartOptions): Promise<void> {
  warnIfBunRuntime();
  if (options.noMcp) {
    const sessionId = await sessionAPI.createSession({
      name: options.name,
      shell: options.shell,
      cwd: options.cwd,
    });
    console.log(`Session created: ${sessionId}`);
    console.log(`State: ${JSON.stringify(sessionAPI.getSession(sessionId))}`);
    console.log('Runtime running (press Ctrl+C to stop)...');
    await new Promise((resolve) => process.on('SIGINT', resolve));
    await sessionAPI.destroySession(sessionId);
    return;
  }

  writePidFile();

  const sessionId = await sessionAPI.createSession({
    name: options.name ?? 'default',
    shell: options.shell,
    cwd: options.cwd,
  });
  logger.info({ sessionId }, 'Started default session');

  const mcp = await startMcpServer();
  logger.info('CoTerm runtime + MCP server ready');

  await waitForStdioClose(mcp);
  await cleanup(mcp, sessionId);
}

export async function cmdMcp(): Promise<void> {
  warnIfBunRuntime();
  writePidFile();
  const mcp = await startMcpServer();
  logger.info('CoTerm MCP server ready (stdio)');
  await waitForStdioClose(mcp);
  await cleanup(mcp);
}

export function cmdStop(): void {
  if (!fs.existsSync(PID_FILE)) {
    console.error('No CoTerm runtime PID file found — nothing to stop');
    return;
  }
  const pid = Number(fs.readFileSync(PID_FILE, 'utf8').trim());
  if (!Number.isInteger(pid) || pid <= 0) {
    console.error(`Invalid PID in ${PID_FILE}`);
    return;
  }
  try {
    if (isWindows()) {
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'pipe' });
    } else {
      process.kill(pid, 'SIGTERM');
    }
    console.log(`Stopped CoTerm runtime (PID ${pid})`);
  } catch (err) {
    console.error(`Failed to stop PID ${pid}: ${(err as Error).message}`);
  } finally {
    fs.rmSync(PID_FILE, { force: true });
  }
}

export function cmdList(): void {
  console.log(JSON.stringify(sessionAPI.listSessions(), null, 2));
}

export function cmdInfo(sessionId: string): void {
  try {
    console.log(JSON.stringify(sessionAPI.getSession(sessionId), null, 2));
  } catch (err) {
    console.error((err as Error).message);
    process.exitCode = 1;
  }
}

export function cmdRead(sessionId: string, lines: number = 50): void {
  try {
    console.log(sessionAPI.readText(sessionId, lines) || '(no output yet)');
  } catch (err) {
    console.error((err as Error).message);
    process.exitCode = 1;
  }
}

export async function cmdWrite(sessionId: string, command: string): Promise<void> {
  try {
    await sessionAPI.runCommand(sessionId, command, 'human');
    console.log(`Wrote command to session ${sessionId}`);
  } catch (err) {
    console.error((err as Error).message);
    process.exitCode = 1;
  }
}

export async function cmdWait(sessionId: string, timeout: number = 30000): Promise<void> {
  try {
    const prompt = await sessionAPI.waitForPrompt(sessionId, timeout);
    console.log(`Prompt detected: ${JSON.stringify(prompt)}`);
  } catch (err) {
    console.error((err as Error).message);
    process.exitCode = 1;
  }
}

export function cmdResize(sessionId: string, cols: number, rows: number): void {
  try {
    sessionAPI.resize(sessionId, cols, rows);
    console.log(`Resized session ${sessionId} to ${cols}x${rows}`);
  } catch (err) {
    console.error((err as Error).message);
    process.exitCode = 1;
  }
}

export function cmdInterrupt(sessionId: string): void {
  try {
    sessionAPI.interrupt(sessionId, 'human');
    console.log(`Interrupted session ${sessionId}`);
  } catch (err) {
    console.error((err as Error).message);
    process.exitCode = 1;
  }
}

export async function cmdClose(sessionId: string): Promise<void> {
  try {
    await sessionAPI.destroySession(sessionId);
    console.log(`Closed session ${sessionId}`);
  } catch (err) {
    console.error((err as Error).message);
    process.exitCode = 1;
  }
}

function warnIfBunRuntime(): void {
  if (typeof process.versions.bun === 'string') {
    console.error(
      '[warn] Running under bun: node-pty ConPTY writes are unreliable under bun on Windows. ' +
        'Use `tsx src/index.ts ...` (Node) or the packaged coterm.exe for terminal sessions.',
    );
  }
}

function writePidFile(): void {  try {
    fs.writeFileSync(PID_FILE, String(process.pid));
  } catch (err) {
    logger.warn({ err }, 'Failed to write PID file');
  }
}

function waitForStdioClose(mcp: CoTermMcpServer): Promise<void> {
  return new Promise((resolve) => {
    const onSignal = () => {
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
      resolve();
    };
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);
  });
}

async function cleanup(mcp: CoTermMcpServer, sessionId?: string): Promise<void> {
  try {
    await mcp.stop();
  } catch (err) {
    logger.warn({ err }, 'Error stopping MCP server');
  }
  if (sessionId) {
    try {
      await sessionAPI.destroySession(sessionId);
    } catch {
      // session may already be closed
    }
  }
  fs.rmSync(PID_FILE, { force: true });
  logger.info('CoTerm runtime stopped');
}
