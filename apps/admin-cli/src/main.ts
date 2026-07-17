import { CommanderError, Command } from 'commander';
import { emitNotImplemented, ExitCode } from './output.js';

// Injected at build time by build.mjs (--define:PKG_VERSION). It is absent when the
// CLI is run straight from source (e.g. `tsx src/main.ts`), where referencing the
// bare identifier would throw ReferenceError. `typeof` is the one operator safe on an
// undeclared name, so this fallback lets the CLI run standalone either way.
declare const PKG_VERSION: string | undefined;
const VERSION = typeof PKG_VERSION === 'string' ? PKG_VERSION : '0.0.0-dev';

async function main(): Promise<void> {
  if (process.argv.includes('--version') || process.argv.includes('-V')) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }

  if (
    process.argv[2] === 'maintenance' &&
    (process.argv[3] === 'enable' || process.argv[3] === 'disable')
  ) {
    emitNotImplemented(`maintenance ${process.argv[3]}`, {});
  }

  const program = new Command();

  program
    .name('admin-cli')
    .description('Kvorum operator administration CLI')
    .version(VERSION)
    .option('-f, --format <format>', 'output format: human or json', 'human')
    .helpCommand(true)
    .exitOverride();

  const topLevelArg = process.argv[2];
  const topLevelCommand =
    topLevelArg !== undefined && !topLevelArg.startsWith('-') ? topLevelArg : undefined;
  const { registerCommands } = await import('./commands/index.js');
  await registerCommands(program, topLevelCommand);

  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    if (error instanceof CommanderError) {
      if (error.code === 'commander.helpDisplayed' || error.code === 'commander.version') {
        return;
      }
      process.stderr.write(`${error.message}\n`);
      process.exit(ExitCode.ValidationFailure);
    }

    throw error;
  }
}

/**
 * Release the shared DB connection pools so the process can exit. `buildContainer()` opens the
 * module-level `pgDb`/`chDb` pools (keep-alive sockets), and the CLI never calls `process.exit(0)`
 * on the happy path — without this teardown a completed command hangs at the prompt on those idle
 * handles. Best-effort: teardown must never mask the command's own result or exit code.
 */
async function closePools(): Promise<void> {
  try {
    const { pgDb, chDb } = await import('@libs/db');
    await Promise.allSettled([pgDb.destroy(), chDb.destroy()]);
  } catch {
    // ignore: the pools may never have been opened (e.g. `--version`)
  }
}

void main().then(
  () => closePools().finally(() => process.exit(process.exitCode ?? 0)),
  (error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
    void closePools().finally(() => process.exit(1));
  },
);
