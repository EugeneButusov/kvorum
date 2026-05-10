import { Command } from 'commander';
import { registerAllCommands } from './commands/index.js';

// Injected at build time by build.mjs (--define:PKG_VERSION)
declare const PKG_VERSION: string;

const program = new Command();

program
  .name('admin-cli')
  .description('Kvorum operator administration CLI')
  .version(PKG_VERSION)
  .option('-f, --format <format>', 'output format: human or json', 'human')
  .helpCommand(true);

registerAllCommands(program);

program.parse(process.argv);
