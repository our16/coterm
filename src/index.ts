import { buildCli } from './cli/index.js';
import { cmdStart } from './cli/commands.js';

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
