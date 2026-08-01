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
  cmdInterrupt,
  cmdClose,
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
    .option('--no-mcp', 'Start runtime without the MCP server (debug mode)')
    .action(async (opts: { shell?: string; cwd?: string; name?: string; mcp: boolean }) => {
      await cmdStart({ shell: opts.shell, cwd: opts.cwd, name: opts.name, noMcp: !opts.mcp });
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
