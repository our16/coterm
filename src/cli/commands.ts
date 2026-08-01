import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { sessionAPI } from '../api/session-api.js';
import { startMcpServer, CoTermMcpServer } from '../mcp/server.js';
import { startHttpMcpServer } from '../mcp/http-server.js';
import { logger } from '../utils/logger.js';
import { getTempDir, isWindows } from '../utils/platform.js';
import { loadConfig, ensureConfig, getMcpHost, getMcpPort, getConfigPath, saveConfig, setConfigValue, writeActiveState, removeActiveState, getPowershellIntegrationPath, readActiveState } from '../config.js';
import { callDaemon, daemonAlive, waitForDaemon, listSessionsFromDaemon, getDaemonUrl, resolveSession, getDaemonVersion, stopDaemonViaCli, streamSessionOutput } from './daemon-client.js';
import { cleanupOrphanedSessions } from '../cleanup.js';
import { VERSION } from '../version.js';

const PID_FILE = path.join(getTempDir(), 'coterm.pid');

function effectiveShell(shell?: string): string | undefined {
  return shell ?? loadConfig().defaultShell;
}

function effectiveCwd(cwd?: string): string | undefined {
  // Default to the caller's current directory, not the daemon's cwd, so a
  // session created in any directory starts there.
  return cwd ?? loadConfig().defaultCwd ?? process.cwd();
}

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

function resolveEntryScript(): string {
  const isScript = (p?: string) => !!p && /\.[cm]?[jt]s$/.test(p) && fs.existsSync(p) && !/tsx|cli\.mjs/.test(p);
  if (isScript(process.argv[1])) return process.argv[1]!;
  if (isScript(process.argv[2])) return process.argv[2]!;
  for (const f of ['src/index.ts', 'dist/index.cjs']) {
    if (fs.existsSync(f)) return f;
  }
  return 'src/index.ts';
}

function spawnDaemonBackground(): void {
  // A pkg exe that spawns itself runs with PKG_EXECPATH set, which puts the
  // child into "strict" mode where argv[1] must be a real module path. Pass
  // the embedded entrypoint as argv[1] so the child boots the snapshot, then
  // 'start --no-session' is parsed as CLI args by the entry.
  const pkg = (process as { pkg?: { entrypoint?: string } }).pkg;
  const entry = resolveEntryScript();
  const isTs = /\.[cm]?ts$/.test(entry);
  const args = pkg
    ? [pkg.entrypoint ?? '', 'start', '--no-session']
    : isTs
      ? ['--import', 'tsx', entry, 'start', '--no-session']
      : [entry, 'start', '--no-session'];
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
      shell: effectiveShell(options.shell),
      cwd: effectiveCwd(options.cwd),
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
      name: options.name,
      shell: effectiveShell(options.shell),
      cwd: effectiveCwd(options.cwd),
      connector,
    });
    logger.info({ sessionId }, 'Started default session');
  }

  const config = loadConfig();
  const host = getMcpHost();
  const port = options.httpPort ?? getMcpPort(config);

  const httpServer = await startHttpMcpServer(sessionAPI, {
    host,
    port,
  });
  logger.info({ url: httpServer.url }, 'CoTerm daemon ready (single process, shared sessions)');

  // Auto-cleanup: close sessions whose creating window has exited.
  cleanupOrphanedSessions(sessionAPI).catch(() => {});
  const cleanupTimer = setInterval(() => {
    cleanupOrphanedSessions(sessionAPI).catch(() => {});
  }, 15000);
  cleanupTimer.unref?.();

  await waitForSignal();
  clearInterval(cleanupTimer);
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
  removeActiveState(process.ppid ?? process.pid);
  if (!fs.existsSync(PID_FILE)) {
    console.error('No CoTerm runtime PID file found 鈥?nothing to stop');
    return;
  }
  const pid = Number(fs.readFileSync(PID_FILE, 'utf8').trim());
  if (!Number.isInteger(pid) || pid <= 0) {
    console.error(`Invalid PID in ${PID_FILE}`);
    return;
  }
  try {
    if (isWindows()) {
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'pipe', windowsHide: true });
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
      shell: effectiveShell(options.shell),
      cwd: effectiveCwd(options.cwd),
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

function ensurePowerShellIntegration(): void {
  // Always rewrite the integration so the installed file tracks the latest
  // template (idempotent — the profile line is only appended once).
  try {
    cmdInstallPowershell();
  } catch {
    // best-effort: integration is optional
  }
}

function generateShellIntegration(exePath: string): string {
  const safeExe = exePath.replace(/'/g, "'\\''");
  return `# CoTerm shell integration (bash/zsh) - generated by 'coterm install-shell'
_CoTerm_EXE='${safeExe}'
_CoTerm_MARKER="$HOME/.config/coterm/active-$$"

# Shorthand commands (read/history excluded): only EXIST after 'coterm'
# activates in this window; unset on stop and gone when the window closes.
_CoTerm_cmds="list status run info create env stop deactivate off interrupt close record replay snapshot restore"

coterm() {
  "$_CoTerm_EXE" "$@"
  local code=$?
  local cmd="\${1:-}"
  if [ -z "$cmd" ] || [ "$cmd" = "activate" ] || [ "$cmd" = "on" ]; then
    for c in $_CoTerm_cmds; do
      eval "function $c() { \"\$_CoTerm_EXE\" $c \"\$@\"; }"
    done
  elif [ "$cmd" = "stop" ] || [ "$cmd" = "deactivate" ] || [ "$cmd" = "off" ]; then
    for c in $_CoTerm_cmds; do
      unset -f "$c" 2>/dev/null
    done
  fi
  return $code
}

_CoTerm_update_prompt() {
  if [ -f "$_CoTerm_MARKER" ]; then
    case "$PS1" in
      "(coterm) "*) : ;;
      *) PS1="(coterm) $PS1" ;;
    esac
  else
    PS1="\${PS1#(coterm) }"
  fi
}

if [ -n "$ZSH_VERSION" ]; then
  precmd_functions+=(_CoTerm_update_prompt)
else
  if [ -n "$PROMPT_COMMAND" ]; then
    PROMPT_COMMAND="_CoTerm_update_prompt; \${PROMPT_COMMAND}"
  else
    PROMPT_COMMAND="_CoTerm_update_prompt"
  fi
fi
`;
}

function isShellIntegrationInstalled(): boolean {
  const integrationFile = path.join(os.homedir(), '.config', 'coterm', 'coterm.sh');
  if (!fs.existsSync(integrationFile)) return false;
  for (const rc of [path.join(os.homedir(), '.bashrc'), path.join(os.homedir(), '.zshrc')]) {
    if (fs.existsSync(rc) && fs.readFileSync(rc, 'utf8').includes('coterm.sh')) return true;
  }
  return false;
}

export function cmdInstallShell(): void {
  const exePath = (process as { pkg?: boolean }).pkg
    ? process.execPath
    : path.resolve(process.cwd(), 'coterm');
  const integrationFile = path.join(os.homedir(), '.config', 'coterm', 'coterm.sh');
  fs.mkdirSync(path.dirname(integrationFile), { recursive: true });
  fs.writeFileSync(integrationFile, generateShellIntegration(exePath), 'utf8');

  const rcFiles = [path.join(os.homedir(), '.bashrc'), path.join(os.homedir(), '.zshrc')];
  const line = `\n# CoTerm\nsource ${integrationFile}\n`;
  for (const rc of rcFiles) {
    if (!fs.existsSync(rc)) continue;
    let content = fs.readFileSync(rc, 'utf8');
    content = content.replace(/.*coterm\.sh.*\r?\n/g, '');
    content = content.replace(/^# CoTerm\r?\n/gm, '');
    if (!content.includes('coterm.sh')) {
      content += line;
    }
    fs.writeFileSync(rc, content, 'utf8');
  }

  console.log('CoTerm shell integration installed:');
  console.log(`  ${integrationFile}`);
  console.log('Restart your shell or run: source ~/.bashrc  (or ~/.zshrc)');
  console.log('Then "coterm" shows a "(coterm) " prefix while active; shorthand commands work directly.');
}

function ensureShellIntegration(): void {
  if (isShellIntegrationInstalled()) return;
  try {
    cmdInstallShell();
    console.log('Shell integration installed automatically (prompt prefix + shorthand commands).');
    console.log('Restart your shell (or source ~/.bashrc / ~/.zshrc) to see "(coterm) ".');
  } catch {
    // best-effort: integration is optional
  }
}

export async function cmdAttach(sessionId?: string): Promise<void> {
  const id = await resolveSession(sessionId);
  await attachToSession(id);
}

/** Path/args used to re-invoke this coterm binary as a CLI. */
function cotermInvokeArgs(sub: string[]): string[] {
  const pkg = (process as { pkg?: { entrypoint?: string } }).pkg;
  const entry = resolveEntryScript();
  if (pkg) return [pkg.entrypoint ?? '', ...sub];
  if (/\.[cm]?ts$/.test(entry)) return ['--import', 'tsx', entry, ...sub];
  return [entry, ...sub];
}

/**
 * Open a NEW terminal window (Windows Terminal tab or a new console host)
 * attached to the given session, so AI-created views pop up for the user.
 */
export async function cmdOpen(sessionId?: string): Promise<void> {
  const id = await resolveSession(sessionId);
  const exe = process.execPath;
  const args = cotermInvokeArgs(['run', id]);

  let launched = false;
  if (isWindows()) {
    // Prefer Windows Terminal (new tab in the current window), fall back to a
    // fresh console host.
    const wt = 'wt.exe';
    try {
      const wtArgs = ['new-tab', exe, ...args];
      spawn(wt, wtArgs, { detached: true, stdio: 'ignore', windowsHide: true });
      launched = true;
    } catch {
      launched = false;
    }
    if (!launched) {
      const cmdLine = `"${exe}" ${args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}`;
      spawn('cmd.exe', ['/c', 'start', '', 'cmd', '/k', cmdLine], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      launched = true;
    }
  } else {
    const term = process.env.TERM_PROGRAM === 'iTerm.app' ? 'iTerm' : process.env.TERM_PROGRAM === 'Apple_Terminal' ? 'open' : '';
    const cmdLine = `"${exe}" ${args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}; exec bash`;
    if (term === 'open') {
      spawn('open', ['-a', 'Terminal', '--', 'bash', '-c', cmdLine], { detached: true, stdio: 'ignore' });
    } else {
      spawn('x-terminal-emulator', ['-e', 'bash', '-c', cmdLine], { detached: true, stdio: 'ignore' });
    }
    launched = true;
  }

  console.log(`Opened a new view for session ${id}.`);
}

/** Push this window's terminal size to the session so the PTY matches. */
function syncTerminalSize(sessionId: string): void {
  const cols = process.stdout.columns ?? 80;
  const rows = process.stdout.rows ?? 24;
  callDaemon('terminal_resize', { sessionId, cols, rows }).catch(() => {});
}

/**
 * Built-in CoTerm commands recognized inside the attached view. Typing one of
 * these runs the CoTerm command (like `coterm <cmd>`) and prints the result to
 * the view, instead of sending the line to the session shell.
 */
const VIEW_COMMANDS: Record<string, (sessionId: string, arg: string) => Promise<string>> = {
  list: async () => {
    const { text, isError } = await callDaemon('terminal_list', {});
    if (isError) return `[error] ${text}`;
    try {
      const sessions = JSON.parse(text) as Array<{ id: string; name: string; state: string; shell: string; cwd: string }>;
      return sessions.map((s) => `${String(s.name ?? '').padEnd(14)}  ${String(s.state ?? '').padEnd(9)}  ${String(s.id ?? '')}`).join('\n');
    } catch {
      return text;
    }
  },
  status: async (sessionId) => {
    const { text, isError } = await callDaemon('terminal_status', { sessionId });
    return isError ? `[error] ${text}` : formatStatus(text);
  },
  read: async (sessionId, arg) => {
    const { text, isError } = await callDaemon('terminal_read', { sessionId, lines: Number(arg) || 50 });
    return isError ? `[error] ${text}` : text;
  },
  history: async (sessionId, arg) => {
    const { text, isError } = await callDaemon('terminal_history', { sessionId, limit: Number(arg) || 50 });
    return isError ? `[error] ${text}` : text;
  },
  interrupt: async (sessionId) => {
    const { text, isError } = await callDaemon('terminal_interrupt', { sessionId });
    return isError ? `[error] ${text}` : text;
  },
  run: async (sessionId, arg) => {
    if (!arg.trim()) return 'usage: run <command>';
    const { text, isError } = await callDaemon('terminal_run', { sessionId, command: arg, timeout: 30000 });
    return isError ? `[error] ${text}` : text;
  },
  wait: async (sessionId, arg) => {
    const { text, isError } = await callDaemon('terminal_wait_prompt', { sessionId, timeout: Number(arg) || 30000 });
    return isError ? `[error] ${text}` : text;
  },
  resize: async (sessionId, arg) => {
    const [c, r] = arg.split(' ');
    const { text, isError } = await callDaemon('terminal_resize', { sessionId, cols: Number(c) || 120, rows: Number(r) || 30 });
    return isError ? `[error] ${text}` : text;
  },
};

function formatStatus(text: string): string {
  try {
    const st = JSON.parse(text) as { cwd?: string; info?: { state?: string }; lastCommand?: { command?: string; error?: boolean }; toolchains?: Record<string, boolean> };
    const lines = [
      `state  : ${st.info?.state ?? '?'}`,
      `cwd    : ${st.cwd ?? '?'}`,
      `last   : ${st.lastCommand?.command ?? '(none)'}${st.lastCommand?.error ? ' [error]' : ''}`,
      `tools  : ${Object.keys(st.toolchains ?? {}).join(', ') || '(none)'}`,
    ];
    return lines.join('\n');
  } catch {
    return text;
  }
}

/**
 * Try to run `cmdLine` as a built-in view command. Returns true if it was a
 * known command (and the result was printed to the view), false otherwise.
 */
function execViewCommandLine(sessionId: string, cmdLine: string): boolean {
  const trimmed = cmdLine.trim();
  const first = trimmed.split(/\s+/)[0] ?? '';
  const handler = VIEW_COMMANDS[first];
  if (!handler) return false;
  const arg = trimmed.slice(first.length).trim();
  // Let the shell render its Ctrl+C cancellation + fresh prompt before we
  // print the result, so the two writers don't interleave on the terminal.
  // The command itself was already echoed by the shell, so only show the result.
  setTimeout(() => {
    void handler(sessionId, arg).then((result) => {
      process.stdout.write(`\x1b[2m${result}\x1b[0m\r\n`);
    }).catch((err) => {
      process.stdout.write(`\x1b[31m${(err as Error).message}\x1b[0m\r\n`);
    });
  }, 60);
  return true;
}

/** Is the current terminal VT/ANSI capable (needed for interactive attach)? */
function isVtTerminal(): boolean {
  if (isWindows()) {
    // Windows Terminal sets WT_SESSION; conhost (classic console) doesn't.
    return !!process.env.WT_SESSION || !!process.env.TERM_PROGRAM;
  }
  return process.stdin.isTTY === true;
}

async function attachToSession(sessionId: string): Promise<void> {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    console.error('Attach requires an interactive terminal (TTY).');
    process.exitCode = 1;
    return;
  }

  if (!isVtTerminal() && process.env.COTERM_FORCE_ATTACH !== '1') {
    console.warn('[warn] Interactive attach needs VT/ANSI support for arrow keys and history.');
    console.warn('  On Windows, run it in Windows Terminal (or set COTERM_FORCE_ATTACH=1 to try anyway).');
  }

  console.log(`Attached to session ${sessionId}. Ctrl+A q detach; Ctrl+C interrupts; type list/status/read/run ... for built-in commands.`);

  // Baseline offset: don't replay what's already been output.
  let offset = 0;
  try {
    const r = await callDaemon('terminal_raw', { sessionId, from: 0 });
    offset = (JSON.parse(r.text) as { offset: number }).offset;
  } catch {
    // ignore
  }

  stdin.setRawMode(true);
  stdin.resume();

  // Restore the console on any exit path (Ctrl+C, error, etc.) so the user's
  // shell isn't left in raw mode (arrows would show as literal ^[A).
  const restore = () => {
    try {
      flushInput();
      stdin.removeListener('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
    } catch {
      // ignore
    }
  };
  const onSig = () => {
    restore();
    process.exit(0);
  };
  process.on('SIGINT', onSig);
  process.on('SIGTERM', onSig);

  let done = false;
  let prefixA = false;

  // Keystrokes are streamed to the shell as-is (so typing feels live and the
  // shell echoes them). We additionally track the current line; on Enter, if
  // the line is a built-in CoTerm command (list/status/read/run/...), we send
  // Ctrl+C to cancel the echoed line (the shell renders `^C` + a fresh prompt)
  // and run it locally, printing the result after the shell settles — no
  // backspace trickery that can race with the live output stream.
  let inputBuffer = '';
  let lineBuf = '';
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  const flushInput = () => {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (!inputBuffer) return;
    const chunk = inputBuffer;
    inputBuffer = '';
    callDaemon('terminal_write', { sessionId, data: chunk, requester: 'human' }).catch(() => {});
  };

  const onData = (chunk: Buffer) => {
    const s = chunk.toString('utf8');
    for (const ch of s) {
      if (prefixA) {
        if (ch === 'q') {
          done = true;
          flushInput();
          return;
        }
        prefixA = false;
      }
      if (ch === '\x01') {
        prefixA = true;
        continue;
      }
      inputBuffer += ch;

      // Track the current line for Enter-time command detection.
      if (ch === '\r' || ch === '\n') {
        const cmd = lineBuf.trim();
        if (cmd && execViewCommandLine(sessionId, cmd)) {
          // Cancel the echoed line in the shell so it doesn't execute.
          inputBuffer = '';
          lineBuf = '';
          callDaemon('terminal_write', { sessionId, data: '\x03', requester: 'human' }).catch(() => {});
          return;
        }
        lineBuf = '';
      } else if (ch === '\x03') {
        lineBuf = '';
      } else if (ch === '\x08' || ch === '\x7f') {
        lineBuf = lineBuf.slice(0, -1);
      } else {
        lineBuf += ch;
      }
    }
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (/[\r\x03]$/.test(inputBuffer)) {
      flushInput();
    } else {
      flushTimer = setTimeout(flushInput, 40);
    }
  };
  stdin.on('data', onData);

  // Keep the PTY sized to this window; re-sync when the terminal resizes.
  syncTerminalSize(sessionId);
  const onResize = () => syncTerminalSize(sessionId);
  process.stdout.on('resize', onResize);

  let sessionEnded = false;

  // Live output: SSE push from the daemon instead of polling. The daemon
  // subscribes to the session's output events and pushes each chunk as it
  // arrives, so what AI writes and what the shell echoes shows up immediately.
  const unsubStream = streamSessionOutput(
    sessionId,
    offset,
    (chunk) => {
      if (chunk.text) {
        process.stdout.write(chunk.text);
        offset = chunk.offset;
      }
    },
    (err) => {
      if (err) {
        console.error(`\n[stream error] ${err.message}`);
      }
      done = true;
    },
  );

  // Watchdog: detect the session shell exiting (e.g. the user typed `exit`).
  const watchdog = setInterval(async () => {
    try {
      const status = await callDaemon('terminal_status', { sessionId });
      const st = JSON.parse(status.text) as { info?: { state?: string } };
      if (st.info && st.info.state === 'closed') {
        sessionEnded = true;
        done = true;
      }
    } catch {
      done = true;
    }
  }, 2000);

  while (!done) {
    await new Promise((resolve) => setTimeout(resolve, 40));
  }

  unsubStream();
  clearInterval(watchdog);
  process.stdout.removeListener('resize', onResize);
  restore();
  process.removeListener('SIGINT', onSig);
  process.removeListener('SIGTERM', onSig);
  process.stdout.write('\n');

  if (sessionEnded) {
    try {
      await callDaemon('terminal_close', { sessionId });
    } catch {
      // already gone
    }
    removeActiveState(process.ppid ?? process.pid);
    console.log('Session ended.');
  } else {
    console.log('Detached (session still active).');
  }
}

export function cmdUsage(): void {
  console.log('CoTerm — AI-native Terminal Session Runtime');
  console.log('');
  console.log('Usage:');
  console.log('  coterm activate         Start the daemon and activate the environment');
  console.log('  coterm stop             Stop the daemon / deactivate this window');
  console.log('  coterm create           Create a session (--connector ssh|wsl|docker ...)');
  console.log('  coterm list             List sessions (after activation)');
  console.log('  coterm run --command "..."  Run a command in your session');
  console.log('  coterm status           Show session state (cwd, tools, command graph)');
  console.log('  coterm config           Show configuration');
  console.log('  coterm install-powershell | install-shell   Set up the shell integration');
  console.log('');
  console.log('Run `coterm activate` to begin. After activation, shorthand commands');
  console.log('(list, run, status, ...) become available in this window.');
}

export async function cmdActivate(options: { shell?: string; cwd?: string; name?: string; view?: boolean } = {}): Promise<void> {
  ensureConfig();

  if (await daemonAlive()) {
    const runningVersion = await getDaemonVersion();
    if (runningVersion === null || runningVersion !== VERSION) {
      console.log(`Running daemon is ${runningVersion ? `version ${runningVersion}` : 'stale'} — restarting to ${VERSION}...`);
      await stopDaemonViaCli();
      await new Promise((r) => setTimeout(r, 500));
      spawnDaemonBackground();
      if (!(await waitForDaemon(30000))) {
        console.error('Timed out waiting for the CoTerm daemon to start.');
        process.exitCode = 1;
        return;
      }
      console.log(`CoTerm daemon started: ${getDaemonUrl()}`);
    } else {
      console.log('CoTerm environment already active.');
    }
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

  const windowPid = process.ppid ?? process.pid;
  if (isWindows()) {
    ensurePowerShellIntegration();
  } else {
    ensureShellIntegration();
  }

  // Each window gets its own session: reuse this window's session if it still
  // exists, otherwise create a new one and remember it in the per-window state.
  const state = readActiveState(windowPid);
  let sessionId: string | undefined;
  if (state?.sessionId) {
    const sessions = await listSessionsFromDaemon();
    if (sessions.some((s) => s.id === state.sessionId && s.state === 'running')) {
      sessionId = state.sessionId;
    }
  }

  if (!sessionId) {
    console.log('Creating a session for this window...');
    const { text, isError } = await callDaemon('terminal_create', {
      name: options.name,
      shell: effectiveShell(options.shell),
      cwd: effectiveCwd(options.cwd),
    });
    if (isError) {
      console.error(text);
      process.exitCode = 1;
      return;
    }
    sessionId = (JSON.parse(text) as { sessionId: string }).sessionId;
    console.log(`Session ready: ${sessionId}`);
  }

  writeActiveState(windowPid, sessionId);

  console.log('');
  console.log('CoTerm environment activated.');
  console.log('  - coterm list / status / run / read  act on this environment');
  console.log(`  - run <command>    execute a command in this session`);
  console.log(`  - MCP endpoint: ${getDaemonUrl()}`);
  console.log(`  - deactivate: coterm stop`);

  // Automatically drop into the shared terminal view so this window IS the
  // session's terminal (real rendering: arrows/history/full-screen apps).
  if (options.view !== false) {
    if (!process.stdin.isTTY) {
      console.log('(non-interactive: not entering the terminal view)');
    } else {
      console.log('');
      console.log('Entering shared terminal view (Ctrl+A q to detach)...');
      await attachToSession(sessionId);
      // After detach, show a hint for how to return.
      console.log('  - re-enter: coterm run   (or run <command> for one-shot)');
    }
  }
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
      console.log('(no sessions 鈥?run: coterm create)');
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

export function cmdDebug(): void {
  console.log(JSON.stringify({ pid: process.pid, ppid: process.ppid, cwd: process.cwd(), argv: process.argv.slice(1) }, null, 2));
}

export function cmdConfigShow(): void {
  const configPath = getConfigPath();
  const config = ensureConfig();
  console.log(`Config file: ${configPath}`);
  console.log('');
  console.log('Effective MCP endpoint:');
  console.log(`  http://${getMcpHost()}:${getMcpPort(config)}/mcp`);
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
$CoTermShorthandNames = @('list','status','run','read','info','create','env','stop','deactivate','off','interrupt','close','record','replay','snapshot','restore')
$script:CoTermShorthandsOn = $false

# Per-window marker: ~/.config/coterm/active-$PID exists after THIS window
# ran activate (raw exe or the coterm function).
$CoTermMarker = "$env:USERPROFILE\\.config\\coterm\\active-$PID"

# Shorthand commands (list/status/run/...) only exist while this window is
# activated. They are shell-session functions, so they vanish when the window
# closes. The prompt below syncs them with the marker (so running the raw exe
# also enables them on the next prompt).
function global:CoTerm-EnableShorthands {
  foreach ($n in $CoTermShorthandNames) {
    & ([scriptblock]::Create("function global:$($n) { & '${safeExe}' $($n) @args }"))
  }
}
function global:CoTerm-DisableShorthands {
  foreach ($n in $CoTermShorthandNames) {
    Remove-Item "Function:$($n)" -ErrorAction SilentlyContinue
  }
}

if (-not $script:CoTermPromptWrapped) {
  $script:CoTermPromptWrapped = $true
  if (Test-Path function:prompt) {
    $script:CoTermOriginalPrompt = (Get-Command prompt).ScriptBlock
  }
  function global:prompt {
    $active = Test-Path $CoTermMarker
    if ($active -and -not $script:CoTermShorthandsOn) {
      CoTerm-EnableShorthands
      $script:CoTermShorthandsOn = $true
    } elseif (-not $active -and $script:CoTermShorthandsOn) {
      CoTerm-DisableShorthands
      $script:CoTermShorthandsOn = $false
    }
    $prefix = ''
    if ($active) { $prefix = '(coterm) ' }
    $base = if ($script:CoTermOriginalPrompt) {
      [string](& $script:CoTermOriginalPrompt)
    } else {
      "PS $($executionContext.SessionState.Path.CurrentLocation)$('>' * ($nestedPromptLevel + 1)) "
    }
    if ($base.StartsWith('(coterm) ')) { $base = $base.Substring(9) }
    return "$prefix$base"
  }
}

function global:coterm {
  & $CoTermExe @args
  $code = $LASTEXITCODE
  $cmd = @($args)[0]
  if ($cmd -eq 'activate' -or $cmd -eq 'on') {
    CoTerm-EnableShorthands
    $script:CoTermShorthandsOn = $true
  } elseif ($cmd -eq 'stop' -or $cmd -eq 'deactivate' -or $cmd -eq 'off') {
    CoTerm-DisableShorthands
    $script:CoTermShorthandsOn = $false
  }
  return $code
}
`;
}

export function cmdInstallPowershell(): void {
  const exePath = (process as { pkg?: boolean }).pkg
    ? process.execPath
    : path.resolve(process.cwd(), 'coterm.exe');
  const integrationFile = getPowershellIntegrationPath();
  fs.mkdirSync(path.dirname(integrationFile), { recursive: true });
  fs.writeFileSync(integrationFile, generatePowershellIntegration(exePath), 'utf8');

  const profilePaths = [
    path.join(os.homedir(), 'Documents', 'PowerShell', 'Microsoft.PowerShell_profile.ps1'),
    path.join(os.homedir(), 'Documents', 'WindowsPowerShell', 'Microsoft.PowerShell_profile.ps1'),
  ];
  const line = `\n# CoTerm\nif (Test-Path "${integrationFile}") { . "${integrationFile}" }\n`;
  for (const p of profilePaths) {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    if (!fs.existsSync(p)) fs.writeFileSync(p, '');
    let content = fs.readFileSync(p, 'utf8');
    // Remove stale old-format lines (flat ~/.config/coterm-powershell.ps1) so they don't linger.
    content = content.replace(/.*coterm-powershell\.ps1.*\r?\n/g, '');
    content = content.replace(/^# CoTerm\r?\n/gm, '');
    if (!content.includes('coterm\\powershell.ps1')) {
      content += line;
    }
    fs.writeFileSync(p, content, 'utf8');
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
