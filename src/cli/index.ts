import { Command } from 'commander';
import { VERSION } from '../version.js';
import {
  cmdStart,
  cmdMcp,
  cmdStop,
  cmdCreate,
  cmdActivate,
  cmdEnvStatus,
  cmdList,
  cmdInfo,
  cmdRead,
  cmdWrite,
  cmdWait,
  cmdResize,
  cmdStatus,
  cmdHistory,
  cmdInterrupt,
  cmdClose,
  cmdRecord,
  cmdReplay,
  cmdSnapshot,
  cmdRestore,
  cmdWorkspaceCreate,
  cmdWorkspaceList,
  cmdWorkspaceAdd,
  cmdWorkspaceRun,
  cmdWorkspaceStatus,
  cmdConfigShow,
  cmdConfigSet,
  cmdInstallPowershell,
  cmdInstallShell,
  cmdDebug,
  cmdUsage,
  cmdAttach,
} from './commands.js';

export function buildCli(): Command {
  const program = new Command();

  program
    .name('coterm')
    .description('CoTerm — AI native terminal runtime. Manage shared terminal sessions for Humans, AI Agents, and MCP tools.')
    .version(VERSION);

  program
    .command('activate')
    .alias('on')
    .description('Start the CoTerm daemon (if not running) and enter the shared session environment')
    .option('--shell <shell>', 'Shell for the default session')
    .option('--cwd <dir>', 'Working directory for the default session')
    .option('--name <name>', 'Name for the default session')
    .action(async (opts: Record<string, unknown>) => {
      await cmdActivate({
        shell: opts.shell as string | undefined,
        cwd: opts.cwd as string | undefined,
        name: opts.name as string | undefined,
      });
    });

  program
    .command('create')
    .description('Create a session in the environment (local / ssh / wsl / docker)')
    .option('--name <name>', 'Session name')
    .option('--shell <shell>', 'Shell executable')
    .option('--cwd <dir>', 'Working directory')
    .option('--connector <type>', 'Connector type: local|ssh|wsl|docker')
    .option('--host <host>', 'Remote host (ssh connector)')
    .option('--port <n>', 'Remote port (ssh connector)', '22')
    .option('--user <user>', 'Remote user (ssh connector)')
    .option('--identity <path>', 'Identity file (ssh connector)')
    .option('--distro <name>', 'WSL distribution (wsl connector)')
    .option('--container <name>', 'Container name/id (docker connector)')
    .action(async (opts: Record<string, unknown>) => {
      await cmdCreate({
        name: opts.name as string | undefined,
        shell: opts.shell as string | undefined,
        cwd: opts.cwd as string | undefined,
        connector: opts.connector as string | undefined,
        host: opts.host as string | undefined,
        port: Number(opts.port ?? 22),
        user: opts.user as string | undefined,
        identity: opts.identity as string | undefined,
        distro: opts.distro as string | undefined,
        container: opts.container as string | undefined,
      });
    });

  program
    .command('start')
    .description('Run the CoTerm daemon in the foreground (serves MCP over HTTP; usually started via `coterm activate`)')
    .option('--shell <shell>', 'Shell executable to use for the default session')
    .option('--cwd <dir>', 'Working directory for the default session')
    .option('--name <name>', 'Name for the default session')
    .option('--connector <type>', 'Connector type: local|ssh|wsl|docker')
    .option('--host <host>', 'Remote host (ssh connector)')
    .option('--port <n>', 'Remote port (ssh connector)', '22')
    .option('--user <user>', 'Remote user (ssh connector)')
    .option('--identity <path>', 'Identity file (ssh connector)')
    .option('--distro <name>', 'WSL distribution (wsl connector)')
    .option('--container <name>', 'Container name/id (docker connector)')
    .option('--http-port <n>', 'MCP HTTP port for the daemon (default from ~/.config/coterm.json)')
    .option('--no-session', 'Start the daemon without creating a default session')
    .option('--no-mcp', 'Debug mode: create a session without starting any MCP server')
    .action(async (opts: Record<string, unknown>) => {
      await cmdStart({
        shell: opts.shell as string | undefined,
        cwd: opts.cwd as string | undefined,
        name: opts.name as string | undefined,
        noMcp: !(opts.mcp as boolean),
        connector: opts.connector as string | undefined,
        host: opts.host as string | undefined,
        port: Number(opts.port ?? 22),
        user: opts.user as string | undefined,
        identity: opts.identity as string | undefined,
        distro: opts.distro as string | undefined,
        container: opts.container as string | undefined,
        httpPort: opts.httpPort === undefined ? undefined : Number(opts.httpPort),
        noSession: opts.session === false,
      });
    });

  program
    .command('mcp')
    .description('Start only the MCP server over stdio (for AI agent connection)')
    .action(async () => {
      await cmdMcp();
    });

  program
    .command('config')
    .description('Show the CoTerm configuration (~/.config/coterm.json)')
    .action(() => {
      cmdConfigShow();
    });

  program
    .command('config-set <key> <value>')
    .description('Set a config value (mcp_server_port, defaultShell, defaultCwd)')
    .action((key: string, value: string) => {
      cmdConfigSet(key, value);
    });

  program
    .command('stop').description('Stop a running CoTerm runtime by PID file').action(() => {
    cmdStop();
  });

  program.command('deactivate').alias('off').description('Alias for coterm stop').action(() => {
    cmdStop();
  });

  program
    .command('install-powershell')
    .description('Install the PowerShell prompt integration (shows "(coterm) " prefix while active)')
    .action(() => {
      cmdInstallPowershell();
    });

  program
    .command('install-shell')
    .description('Install the bash/zsh integration (prompt prefix + shorthand commands)')
    .action(() => {
      cmdInstallShell();
    });

  program
    .command('list')
    .description('List sessions in the active environment')
    .action(async () => {
      await cmdList();
    });

  program
    .command('info [sessionId]')
    .description('Get info about a session (defaults to the first running session)')
    .action(async (sessionId?: string) => {
      await cmdInfo(sessionId);
    });

  program
    .command('read [sessionId]')
    .description('Read the last N lines of session output')
    .option('--lines <n>', 'Number of lines', '50')
    .action(async (sessionId: string | undefined, opts: { lines: string }) => {
      await cmdRead(sessionId, Number(opts.lines));
    });

  program
    .command('run [sessionId]')
    .description('Run a command in a session (defaults to the first running session) and wait for the prompt')
    .requiredOption('--command <cmd>', 'Command to run')
    .action(async (sessionId: string | undefined, opts: { command: string }) => {
      await cmdWrite(sessionId, opts.command);
    });

  program
    .command('wait [sessionId]')
    .description('Wait for the next shell prompt (command completion)')
    .option('--timeout <ms>', 'Timeout in milliseconds', '30000')
    .action(async (sessionId: string | undefined, opts: { timeout: string }) => {
      await cmdWait(sessionId, Number(opts.timeout));
    });

  program
    .command('resize [sessionId]')
    .description('Resize a session')
    .requiredOption('--cols <n>', 'Column count')
    .requiredOption('--rows <n>', 'Row count')
    .action(async (sessionId: string | undefined, opts: { cols: string; rows: string }) => {
      await cmdResize(sessionId, Number(opts.cols), Number(opts.rows));
    });

  program
    .command('status [sessionId]')
    .description('Show session intelligence (cwd, toolchains, full-screen app, command graph)')
    .action(async (sessionId?: string) => {
      await cmdStatus(sessionId);
    });

  program
    .command('history [sessionId]')
    .description('Show the recorded command graph for a session')
    .option('--limit <n>', 'Max commands', '50')
    .action(async (sessionId: string | undefined, opts: { limit: string }) => {
      await cmdHistory(sessionId, Number(opts.limit));
    });

  program
    .command('record [sessionId] <action>')
    .description('Start or stop recording a session (actions: start|stop)')
    .action(async (sessionId: string | undefined, action: string) => {
      if (action !== 'start' && action !== 'stop') {
        console.error('Action must be start or stop');
        process.exitCode = 1;
        return;
      }
      await cmdRecord(sessionId, action);
    });

  program
    .command('replay [sessionId]')
    .description('Replay recorded session events as JSONL')
    .option('--format <fmt>', 'Output format: jsonl|json', 'jsonl')
    .action(async (sessionId: string | undefined, opts: { format: string }) => {
      await cmdReplay(sessionId, opts.format === 'json' ? 'json' : 'jsonl');
    });

  program
    .command('snapshot [sessionId]')
    .description('Capture a session snapshot')
    .option('--out <file>', 'Write snapshot to file')
    .action(async (sessionId: string | undefined, opts: { out?: string }) => {
      await cmdSnapshot(sessionId, opts.out);
    });

  program
    .command('restore <file>')
    .description('Restore a session from a snapshot file')
    .action(async (file: string) => {
      await cmdRestore(file);
    });

  program
    .command('workspace')
    .description('Manage session workspaces')
    .argument('<action>', 'create|list|add|run|status')
    .argument('[args...]', 'arguments: create <name>; add <workspaceId> [sessionId]; run <workspaceId> --command <cmd>; status <workspaceId>')
    .option('--command <cmd>', 'Command to run (for the run action)')
    .action(async (action: string, args: string[], opts: { command?: string }) => {
      switch (action) {
        case 'create': {
          const name = args[0];
          if (!name) return console.error('Usage: coterm workspace create <name>');
          await cmdWorkspaceCreate(name);
          break;
        }
        case 'list':
          await cmdWorkspaceList();
          break;
        case 'add': {
          const ws = args[0];
          if (!ws) return console.error('Usage: coterm workspace add <workspaceId> [sessionId]');
          await cmdWorkspaceAdd(ws, args[1]);
          break;
        }
        case 'run': {
          const ws = args[0];
          if (!ws || !opts.command) return console.error('Usage: coterm workspace run <workspaceId> --command <cmd>');
          await cmdWorkspaceRun(ws, opts.command);
          break;
        }
        case 'status': {
          const ws = args[0];
          if (!ws) return console.error('Usage: coterm workspace status <workspaceId>');
          await cmdWorkspaceStatus(ws);
          break;
        }
        default:
          console.error(`Unknown workspace action: ${action}`);
          process.exitCode = 1;
      }
    });

  program
    .command('interrupt [sessionId]')
    .description('Send Ctrl+C to interrupt a session')
    .action(async (sessionId?: string) => {
      await cmdInterrupt(sessionId);
    });

  program
    .command('close [sessionId]')
    .description('Close and destroy a session')
    .action(async (sessionId?: string) => {
      await cmdClose(sessionId);
    });

  program
    .command('env')
    .description('Show whether the CoTerm environment is active and its sessions')
    .action(async () => {
      await cmdEnvStatus();
    });

  program
    .command('attach [sessionId]')
    .description('Attach an interactive terminal to a session (Ctrl+A q to detach)')
    .action(async (sessionId?: string) => {
      await cmdAttach(sessionId);
    });

  program.action(() => {
    cmdUsage();
  });

  program
    .command('debug')
    .description('Print process diagnostics (pid, ppid, cwd)')
    .action(() => {
      cmdDebug();
    });

  return program;
}
