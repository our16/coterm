import { buildCli } from './cli/index.js';

async function main(): Promise<void> {
  const program = buildCli();
  await program.parseAsync(process.argv);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
