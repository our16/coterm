import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync, spawn } from 'node:child_process';
import { sessionAPI } from '../api/session-api.js';
import { startMcpServer, CoTermMcpServer } from '../mcp/server.js';
import { startHttpMcpServer } from '../mcp/http-server.js';
import { logger } from '../utils/logger.js';
import { getTempDir, isWindows } from '../utils/platform.js';
import { loadConfig, getMcpHost, getMcpPort, getConfigPath, saveConfig, setConfigValue, writeActiveMarker, removeActiveMarker } from '../config.js';
import { callDaemon, daemonAlive, waitForDaemon, listSessionsFromDaemon, getDaemonUrl, resolveSession } from './daemon-client.js';

const PID_FILE = path.join(getTempDir(), 'coterm.pid');

function daemonError(err: unknown): void {
  const message = (err as Error).message ?? String(err);
  if (/ECONNREFUSED|fetch failed|not running|connect/i.test(message)) {
    console.error('CoTerm environment is not active.');
    console.error('Start it first: coterm activate');
  } else {
    console.error(message);
  }
  process.exitCode = 1;
}

function spawnDaemonBackground(): void {
  // A pkg exe that spawns itself runs with PKG_EXECPATH set, which puts the
  // child into "strict" mode where argv[1] must be a real module path. Pass
  // the embedded entrypoint as argv[1] so the child boots the snapshot, then
  // 'start --no-session' is parsed as CLI args by the entry.
  const pkg = (process as { pkg?: { entrypoint?: string } }).pkg;
  const args = pkg
    ? [pkg.entrypoint ?? '', 'start', '--no-session']
    : [process.argv[1] ?? 'src/index.ts', 'start', '--no-session'];
  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
}

export interface StartOptions {
  shell?: string;
  cwd?: string;
  name?: string;
  noMcp?: boolean;
  connector?: string;
  host?: string;
  port?: number;
  user?: string;
  identity?: string;
  distro?: string;
  container?: string;
  httpPort?: number;
  noSession?: boolean;
}

export async function cmdStart(options: StartOptions): Promise<void> {
  warnIfBunRuntime();

  const connector = options.connector
    ? {
        type: options.connector as 'local' | 'ssh' | 'wsl' | 'docker',
        host: options.host,
        port: options.port,
        user: options.user,
        identity: options.identity,
        distro: options.distro,
        container: options.container,
      }
    : undefined;

  if (options.noMcp) {
    const sessionId = await sessionAPI.createSession({
      name: options.name,
      shell: options.shell,
      cwd: options.cwd,
      connector,
    });
    console.log(`Session created: ${sessionId}`);
    console.log(`State: ${JSON.stringify(sessionAPI.getSession(sessionId))}`);
    console.log('Runtime running (press Ctrl+C to stop)...');
    await new Promise((resolve) => process.on('SIGINT', resolve));
    await sessionAPI.destroySession(sessionId);
    return;
  }

  writePidFile();

  if (!options.noSession) {
    const sessionId = await sessionAPI.createSession({
      name: options.name ?? 'default',
      shell: options.shell,
      cwd: options.cwd,
      connector,
    });
    logger.info({ sessionId }, 'Started default session');
  }

  const config = loadConfig();
  const host = getMcpHost(config);
  const port = options.httpPort ?? getMcpPort(config);

  const httpServer = await startHttpMcpServer(sessionAPI, {
    host,
    port,
  });
  logger.info({ url: httpServer.url }, 'CoTerm daemon ready (single process, shared sessions)');

  await waitForSignal();
  await httpServer.stop();
  await cleanup();
}

export async function cmdMcp(): Promise<void> {
  warnIfBunRuntime();
  writePidFile();
  const mcp = await startMcpServer();
  logger.info('CoTerm MCP server ready (stdio)');
  await waitForStdioClose(mcp);
  await mcp.stop();
  await cleanup();
}
export function cmdStop(): void {
  removeActiveMarker();
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

export async function cmdCreate(options: { name?: string; shell?: string; cwd?: string; connector?: string; host?: string; port?: number; user?: string; identity?: string; distro?: string; container?: string } = {}): Promise<void> {
  try {
    const connector = options.connector
      ? {
          type: options.connector as 'local' | 'ssh' | 'wsl' | 'docker',
          host: options.host,
          port: options.port,
          user: options.user,
          identity: options.identity,
          distro: options.distro,
          container: options.container,
        }
      : undefined;
    const { text, isError } = await callDaemon('terminal_create', {
      name: options.name,
      shell: options.shell,
      cwd: options.cwd,
      connector,
    });
    if (isError) {
      console.error(text);
      process.exitCode = 1;
      return;
    }
    const { sessionId } = JSON.parse(text);
    console.log(`Session created: ${sessionId}`);
    console.log(`Use: coterm status ${sessionId}`);
  } catch (err) {
    daemonError(err);
  }
}

export async function cmdActivate(options: { shell?: string; cwd?: string; name?: string } = {}): Promise<void> {
  if (await daemonAlive()) {
    console.log('CoTerm environment already active.');
  } else {
    console.log('Starting CoTerm daemon...');
    spawnDaemonBackground();
    if (!(await waitForDaemon(30000))) {
      console.error('Timed out waiting for the CoTerm daemon to start.');
      process.exitCode = 1;
      return;
    }
    console.log(`CoTerm daemon started: ${getDaemonUrl()}`);
  }

  writeActiveMarker();

  const sessions = await listSessionsFromDaemon();
  if (sessions.length === 0) {
    console.log('Creating a default session...');
    const { text, isError } = await callDaemon('terminal_create', {
      name: options.name ?? 'default',
      shell: options.shell,
      cwd: options.cwd,
    });
    if (isError) {
      console.error(text);
      process.exitCode = 1;
      return;
    }
    const { sessionId } = JSON.parse(text);
    console.log(`Default session ready: ${sessionId}`);
  } else {
    console.log(`Sessions in environment: ${sessions.length}`);
  }

  console.log('');
  console.log('CoTerm environment activated.');
  console.log('  - coterm list / status / run / read  act on this environment');
  console.log(`  - MCP endpoint: ${getDaemonUrl()}`);
  console.log(`  - deactivate: coterm stop`);
}

export async function cmdEnvStatus(): Promise<void> {
  if (!(await daemonAlive())) {
    console.log('CoTerm environment: INACTIVE');
    console.log(`Run: coterm activate`);
    return;
  }
  const sessions = await listSessionsFromDaemon();
  console.log(`CoTerm environment: ACTIVE (${getDaemonUrl()})`);
  console.log(`Sessions: ${sessions.length}`);
  for (const s of sessions) {
    console.log(`  - ${s.name}  [${s.state}]  ${s.id}`);
  }
}

export async function cmdList(): Promise<void> {
  try {
    const { text } = await callDaemon('terminal_list');
    const sessions = JSON.parse(text);
    if (sessions.length === 0) {
      console.log('(no sessions — run: coterm create)');
      return;
    }
    console.log(`${'ID'.padEnd(38)}  ${'NAME'.padEnd(12)}  ${'STATE'.padEnd(9)}  ${'SHELL'.padEnd(16)}  CWD`);
    for (const s of sessions) {
      console.log(
        `${String(s.id).padEnd(38)}  ${String(s.name ?? '').padEnd(12)}  ${String(s.state ?? '').padEnd(9)}  ${String(s.shell ?? '').padEnd(16)}  ${String(s.cwd ?? '')}`,
      );
    }
  } catch (err) {
    daemonError(err);
  }
}

export async function cmdInfo(sessionId?: string): Promise<void> {
  try {
    const id = await resolveSession(sessionId);
    const { text, isError } = await callDaemon('terminal_status', { sessionId: id });
    if (isError) {
      console.error(text);
      process.exitCode = 1;
      return;
    }
    const st = JSON.parse(text);
    const info = st.info ?? {};
    console.log(
      `${String(id).padEnd(38)}  ${String(info.name ?? '').padEnd(12)}  ${String(st.state ?? '').padEnd(9)}  ${String(info.shell ?? '').padEnd(16)}  ${String(st.cwd ?? '')}`,
    );
  } catch (err) {
    daemonError(err);
  }
}

export async function cmdRead(sessionId?: string, lines: number = 50): Promise<void> {
  try {
    const id = await resolveSession(sessionId);
    const { text, isError } = await callDaemon('terminal_read', { sessionId: id, lines });
    if (isError) {
      console.error(text);
      process.exitCode = 1;
      return;
    }
    console.log(text || '(no output yet)');
  } catch (err) {
    daemonError(err);
  }
}

export async function cmdWrite(sessionId: string | undefined, command: string): Promise<void> {
  try {
    const id = await resolveSession(sessionId);
    const { text, isError } = await callDaemon('terminal_run', { sessionId: id, command, timeout: 30000 });
    if (isError) {
      console.error(text);
      process.exitCode = 1;
      return;
    }
    console.log(text);
  } catch (err) {
    daemonError(err);
  }
}

export async function cmdWait(sessionId: string | undefined, timeout: number = 30000): Promise<void> {
  try {
    const id = await resolveSession(sessionId);
    const { text, isError } = await callDaemon('terminal_wait_prompt', { sessionId: id, timeout });
    if (isError) {
      console.error(text);
      process.exitCode = 1;
      return;
    }
    console.log(text);
  } catch (err) {
    daemonError(err);
  }
}

export async function cmdResize(sessionId: string | undefined, cols: number, rows: number): Promise<void> {
  try {
    const id = await resolveSession(sessionId);
    const { text } = await callDaemon('terminal_resize', { sessionId: id, cols, rows });
    console.log(text);
  } catch (err) {
    daemonError(err);
  }
}

export async function cmdStatus(sessionId?: string): Promise<void> {
  try {
    const id = await resolveSession(sessionId);
    const { text, isError } = await callDaemon('terminal_status', { sessionId: id });
    if (isError) {
      console.error(text);
      process.exitCode = 1;
      return;
    }
    const st = JSON.parse(text);
    const info = st.info ?? {};
    const cmd = st.lastCommand;
    console.log(`Session : ${info.name ?? ''}  (${id})`);
    console.log(`State   : ${st.state ?? ''}   Presence: ${st.presence ?? ''}   Full-screen app: ${st.fullScreenApp ? 'yes' : 'no'}`);
    console.log(`CWD     : ${st.cwd ?? ''}`);
    console.log(`Shell   : ${info.shell ?? ''}`);
    if (st.toolchains && Object.keys(st.toolchains).length) {
      console.log(`Tools   : ${Object.keys(st.toolchains).join(', ')}`);
    }
    if (st.participants && st.participants.length) {
      console.log(`AI      : ${st.participants.join(', ')}`);
    }
    if (cmd) {
      console.log(`Last cmd: ${cmd.command}  (${cmd.requester ?? ''}, ${cmd.error ? 'error' : 'ok'}, ${cmd.durationMs ?? '?'}ms)`);
    }
  } catch (err) {
    daemonError(err);
  }
}

export async function cmdHistory(sessionId?: string, limit: number = 50): Promise<void> {
  try {
    const id = await resolveSession(sessionId);
    const { text } = await callDaemon('terminal_history', { sessionId: id, limit });
    console.log(JSON.stringify(JSON.parse(text), null, 2));
  } catch (err) {
    daemonError(err);
  }
}

export async function cmdInterrupt(sessionId?: string): Promise<void> {
  try {
    const id = await resolveSession(sessionId);
    const { text } = await callDaemon('terminal_interrupt', { sessionId: id });
    console.log(text);
  } catch (err) {
    daemonError(err);
  }
}

export async function cmdClose(sessionId?: string): Promise<void> {
  try {
    const id = await resolveSession(sessionId);
    const { text } = await callDaemon('terminal_close', { sessionId: id });
    console.log(text);
  } catch (err) {
    daemonError(err);
  }
}

export async function cmdRecord(sessionId: string | undefined, action: 'start' | 'stop'): Promise<void> {
  try {
    const id = await resolveSession(sessionId);
    const { text } = await callDaemon('terminal_recording', { sessionId: id, action });
    console.log(text);
  } catch (err) {
    daemonError(err);
  }
}

export async function cmdReplay(sessionId: string | undefined, format: 'jsonl' | 'json' = 'jsonl'): Promise<void> {
  try {
    const id = await resolveSession(sessionId);
    const { text } = await callDaemon('terminal_replay', { sessionId: id, format });
    console.log(text || '(no recorded events)');
  } catch (err) {
    daemonError(err);
  }
}

export async function cmdSnapshot(sessionId: string | undefined, outFile?: string): Promise<void> {
  try {
    const id = await resolveSession(sessionId);
    const { text, isError } = await callDaemon('terminal_snapshot', { sessionId: id });
    if (isError) {
      console.error(text);
      process.exitCode = 1;
      return;
    }
    const body = JSON.stringify(JSON.parse(text), null, 2);
    if (outFile) {
      fs.writeFileSync(outFile, body);
      console.log(`Snapshot written to ${outFile}`);
    } else {
      console.log(body);
    }
  } catch (err) {
    daemonError(err);
  }
}

export async function cmdRestore(snapshotFile: string): Promise<void> {
  try {
    const raw = fs.readFileSync(snapshotFile, 'utf8');
    const { text, isError } = await callDaemon('terminal_restore', { snapshot: raw });
    if (isError) {
      console.error(text);
      process.exitCode = 1;
      return;
    }
    console.log(text);
  } catch (err) {
    daemonError(err);
  }
}

export async function cmdWorkspaceCreate(name: string): Promise<void> {
  try {
    const { text } = await callDaemon('workspace_create', { name });
    console.log(text);
  } catch (err) {
    daemonError(err);
  }
}

export async function cmdWorkspaceList(): Promise<void> {
  try {
    const { text } = await callDaemon('workspace_list');
    console.log(JSON.stringify(JSON.parse(text), null, 2));
  } catch (err) {
    daemonError(err);
  }
}

export async function cmdWorkspaceAdd(workspaceId: string, sessionId?: string): Promise<void> {
  try {
    const id = await resolveSession(sessionId);
    const { text } = await callDaemon('workspace_add', { workspaceId, sessionId: id });
    console.log(text);
  } catch (err) {
    daemonError(err);
  }
}

export async function cmdWorkspaceRun(workspaceId: string, command: string): Promise<void> {
  try {
    const { text } = await callDaemon('workspace_run', { workspaceId, command });
    console.log(JSON.stringify(JSON.parse(text), null, 2));
  } catch (err) {
    daemonError(err);
  }
}

export async function cmdWorkspaceStatus(workspaceId: string): Promise<void> {
  try {
    const { text } = await callDaemon('workspace_status', { workspaceId });
    console.log(JSON.stringify(JSON.parse(text), null, 2));
  } catch (err) {
    daemonError(err);
  }
}

export function cmdConfigShow(): void {
  const configPath = getConfigPath();
  const config = loadConfig();
  console.log(`Config file: ${configPath}`);
  console.log('');
  console.log('Effective MCP endpoint:');
  console.log(`  http://${getMcpHost(config)}:${getMcpPort(config)}/mcp`);
  console.log('');
  console.log(JSON.stringify(config, null, 2));
}

export function cmdConfigSet(key: string, value: string): void {
  try {
    const config = loadConfig();
    setConfigValue(config, key, value);
    saveConfig(config);
    console.log(`Set ${key} = ${value} in ${getConfigPath()}`);
  } catch (err) {
    console.error((err as Error).message);
    process.exitCode = 1;
  }
}

function generatePowershellIntegration(exePath: string): string {
  const safeExe = exePath.replace(/'/g, "''");
  return `# CoTerm PowerShell integration (generated by 'coterm install-powershell')
$CoTermExe = '${safeExe}'
$CoTermActiveMarker = "$env:USERPROFILE\\.config\\coterm-active"
$CoTermShorthandNames = @('list','status','run','read','info','create','env','stop','deactivate','off','interrupt','close','record','replay','snapshot','restore')

# Prompt: show "(coterm) " whenever the environment is active (marker written by 'coterm activate').
if (-not $script:CoTermPromptWrapped) {
  $script:CoTermPromptWrapped = $true
  if (Test-Path function:prompt) {
    $script:CoTermOriginalPrompt = (Get-Command prompt).ScriptBlock
  }
  function global:prompt {
    $prefix = ''
    if (Test-Path $CoTermActiveMarker) { $prefix = '(coterm) ' }
    # Preserve conda-style prompt modifiers (e.g. "(base) ") even if our wrap
    # captured the base prompt before conda defined its own.
    $conda = $env:CONDA_PROMPT_MODIFIER
    if ($conda) { $prefix = "$prefix$conda" }
    $base = if ($script:CoTermOriginalPrompt) {
      [string](& $script:CoTermOriginalPrompt)
    } else {
      "PS $($executionContext.SessionState.Path.CurrentLocation)$('>' * ($nestedPromptLevel + 1)) "
    }
    if ($conda -and $base.StartsWith($conda)) {
      $base = $base.Substring($conda.Length)
    }
    return "$prefix$base"
  }
}

# Shorthand commands: available in every shell, they talk to the daemon directly.
foreach ($n in $CoTermShorthandNames) {
  & ([scriptblock]::Create("function global:$($n) { & '${safeExe}' $($n) @args }"))
}

function global:coterm {
  & $CoTermExe @args
}
`;
}

export function cmdInstallPowershell(): void {
  const exePath = (process as { pkg?: boolean }).pkg
    ? process.execPath
    : path.resolve(process.cwd(), 'coterm.exe');
  const integrationFile = path.join(os.homedir(), '.config', 'coterm-powershell.ps1');
  fs.mkdirSync(path.dirname(integrationFile), { recursive: true });
  fs.writeFileSync(integrationFile, generatePowershellIntegration(exePath), 'utf8');

  const profilePaths = [
    path.join(os.homedir(), 'Documents', 'PowerShell', 'Microsoft.PowerShell_profile.ps1'),
    path.join(os.homedir(), 'Documents', 'WindowsPowerShell', 'Microsoft.PowerShell_profile.ps1'),
  ];
  const line = `\n# CoTerm\nif (Test-Path "${integrationFile}") { . "${integrationFile}" }\n`;
  let wrote = false;
  for (const p of profilePaths) {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    if (!fs.existsSync(p)) fs.writeFileSync(p, '');
    if (!fs.readFileSync(p, 'utf8').includes('coterm-powershell')) {
      fs.appendFileSync(p, line);
    }
    wrote = true;
  }
  if (!wrote) {
    const p = profilePaths[0];
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, line);
  }

  console.log('CoTerm PowerShell integration installed:');
  console.log(`  ${integrationFile}`);
  console.log('Reload your profile to activate it:  . $PROFILE');
  console.log('Then "coterm" shows a "(coterm) " prefix while the environment is active; "coterm stop" clears it.');
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

function waitForSignal(): Promise<void> {
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

function cleanup(): void {
  fs.rmSync(PID_FILE, { force: true });
  logger.info('CoTerm daemon stopped');
}
