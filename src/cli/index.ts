import { Command } from 'commander';
import {
  cmdStart,
  cmdMcp,
  cmdStop,
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
} from './commands.js';

export function buildCli(): Command {
  const program = new Command();

  program
    .name('coterm')
    .description('CoTerm AI Session Runtime — manage terminal sessions for AI collaboration')
    .version('0.1.0');

  program
    .command('start')
    .description('Start the CoTerm runtime with MCP server over stdio')
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
    .option('--no-mcp', 'Start runtime without the MCP server (debug mode)')
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
      });
    });

  program
    .command('mcp')
    .description('Start only the MCP server over stdio (for AI agent connection)')
    .action(async () => {
      await cmdMcp();
    });

  program.command('stop').description('Stop a running CoTerm runtime by PID file').action(() => {
    cmdStop();
  });

  program.command('list').description('List active sessions').action(() => {
    cmdList();
  });

  program
    .command('info <sessionId>')
    .description('Get info about a session')
    .action((sessionId: string) => {
      cmdInfo(sessionId);
    });

  program
    .command('read <sessionId>')
    .description('Read the last N lines of session output')
    .option('--lines <n>', 'Number of lines', '50')
    .action((sessionId: string, opts: { lines: string }) => {
      cmdRead(sessionId, Number(opts.lines));
    });

  program
    .command('write <sessionId>')
    .description('Write a command to a session')
    .requiredOption('--command <cmd>', 'Command to write')
    .action(async (sessionId: string, opts: { command: string }) => {
      await cmdWrite(sessionId, opts.command);
    });

  program
    .command('wait <sessionId>')
    .description('Wait for the next shell prompt (command completion)')
    .option('--timeout <ms>', 'Timeout in milliseconds', '30000')
    .action(async (sessionId: string, opts: { timeout: string }) => {
      await cmdWait(sessionId, Number(opts.timeout));
    });

  program
    .command('resize <sessionId>')
    .description('Resize a session')
    .requiredOption('--cols <n>', 'Column count')
    .requiredOption('--rows <n>', 'Row count')
    .action((sessionId: string, opts: { cols: string; rows: string }) => {
      cmdResize(sessionId, Number(opts.cols), Number(opts.rows));
    });

  program
    .command('status <sessionId>')
    .description('Show session intelligence (cwd, toolchains, full-screen app, command graph)')
    .action((sessionId: string) => {
      cmdStatus(sessionId);
    });

  program
    .command('history <sessionId>')
    .description('Show the recorded command graph for a session')
    .option('--limit <n>', 'Max commands', '50')
    .action((sessionId: string, opts: { limit: string }) => {
      cmdHistory(sessionId, Number(opts.limit));
    });

  program
    .command('record <sessionId> <action>')
    .description('Start or stop recording a session (actions: start|stop)')
    .action((sessionId: string, action: string) => {
      if (action !== 'start' && action !== 'stop') {
        console.error('Action must be start or stop');
        process.exitCode = 1;
        return;
      }
      cmdRecord(sessionId, action);
    });

  program
    .command('replay <sessionId>')
    .description('Replay recorded session events as JSONL')
    .option('--format <fmt>', 'Output format: jsonl|json', 'jsonl')
    .action((sessionId: string, opts: { format: string }) => {
      cmdReplay(sessionId, opts.format === 'json' ? 'json' : 'jsonl');
    });

  program
    .command('snapshot <sessionId>')
    .description('Capture a session snapshot')
    .option('--out <file>', 'Write snapshot to file')
    .action((sessionId: string, opts: { out?: string }) => {
      cmdSnapshot(sessionId, opts.out);
    });

  program
    .command('restore <file>')
    .description('Restore a session from a snapshot file')
    .action(async (file: string) => {
      await cmdRestore(file);
    });

  program
    .command('interrupt <sessionId>')
    .description('Send Ctrl+C to interrupt a session')
    .action((sessionId: string) => {
      cmdInterrupt(sessionId);
    });

  program
    .command('close <sessionId>')
    .description('Close and destroy a session')
    .action(async (sessionId: string) => {
      await cmdClose(sessionId);
    });

  return program;
}
