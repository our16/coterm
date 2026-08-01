import { buildCli } from './cli/index.js';
import { cmdStart } from './cli/commands.js';
import { createRequire } from 'node:module';

// node-pty forks a `conpty_console_list_agent` (a new node.exe) without
// windowsHide, which flashes a console window when running from the hidden
// daemon. Patch the CJS child_process module (same object node-pty uses) to
// force windowsHide on every fork so it stays silent.
const _require = createRequire(import.meta.url);
const _cp = _require('node:child_process') as Record<string, unknown>;
const _origFork = _cp.fork as (...a: unknown[]) => unknown;
_cp.fork = (modulePath: unknown, args?: unknown, options?: unknown) =>
  _origFork(modulePath, args, { ...((options as Record<string, unknown>) ?? {}), windowsHide: true });

async function main(): Promise<void> {
  // Internal daemon entry: spawned by `coterm activate` without CLI args.
  if (process.env.COTERM_DAEMON === '1') {
    await cmdStart({ noSession: true });
    return;
  }
  const program = buildCli();
  await program.parseAsync(process.argv);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
