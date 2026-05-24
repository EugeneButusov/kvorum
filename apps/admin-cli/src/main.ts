import { CommanderError, Command } from 'commander';
import { registerAllCommands } from './commands/index.js';
import { ExitCode } from './output.js';

// Injected at build time by build.mjs (--define:PKG_VERSION)
declare const PKG_VERSION: string;

async function main(): Promise<void> {
  const program = new Command();

  program
    .name('admin-cli')
    .description('Kvorum operator administration CLI')
    .version(PKG_VERSION)
    .option('-f, --format <format>', 'output format: human or json', 'human')
    .helpCommand(true)
    .exitOverride();

  registerAllCommands(program);

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

void main();
