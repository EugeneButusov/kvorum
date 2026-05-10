import { Command } from 'commander';
import { registerAllCommands } from './index.js';

function buildProgram(): Command {
  const program = new Command();
  program
    .name('admin-cli')
    .description('Kvorum operator administration CLI')
    .version('0.0.0')
    .option('-f, --format <format>', 'output format: human or json', 'human')
    .helpCommand(true);
  registerAllCommands(program);
  return program;
}

function domainHelp(program: Command, name: string): string {
  const cmd = program.commands.find((c) => c.name() === name);
  if (!cmd) throw new Error(`command not found: ${name}`);
  return cmd.helpInformation();
}

function subHelp(program: Command, domain: string, sub: string): string {
  const domainCmd = program.commands.find((c) => c.name() === domain);
  if (!domainCmd) throw new Error(`domain not found: ${domain}`);
  const subCmd = domainCmd.commands.find((c) => c.name() === sub);
  if (!subCmd) throw new Error(`sub-command not found: ${domain} ${sub}`);
  return subCmd.helpInformation();
}

describe('admin-cli help snapshots', () => {
  let program: Command;

  beforeEach(() => {
    program = buildProgram();
  });

  it('top-level --help', () => {
    expect(program.helpInformation()).toMatchSnapshot();
  });

  it('dao --help', () => {
    expect(domainHelp(program, 'dao')).toMatchSnapshot();
  });

  it('dao source --help', () => {
    expect(subHelp(program, 'dao', 'source')).toMatchSnapshot();
  });

  it('backfill --help', () => {
    expect(domainHelp(program, 'backfill')).toMatchSnapshot();
  });

  it('derive --help', () => {
    expect(domainHelp(program, 'derive')).toMatchSnapshot();
  });

  it('actor --help', () => {
    expect(domainHelp(program, 'actor')).toMatchSnapshot();
  });

  it('dlq --help', () => {
    expect(domainHelp(program, 'dlq')).toMatchSnapshot();
  });

  it('ai --help', () => {
    expect(domainHelp(program, 'ai')).toMatchSnapshot();
  });

  it('user --help', () => {
    expect(domainHelp(program, 'user')).toMatchSnapshot();
  });

  it('keys --help', () => {
    expect(domainHelp(program, 'keys')).toMatchSnapshot();
  });

  it('reorg --help', () => {
    expect(domainHelp(program, 'reorg')).toMatchSnapshot();
  });

  it('status --help', () => {
    expect(domainHelp(program, 'status')).toMatchSnapshot();
  });

  it('audit --help', () => {
    expect(domainHelp(program, 'audit')).toMatchSnapshot();
  });

  it('audit list --help', () => {
    const audit = program.commands.find((c) => c.name() === 'audit');
    if (!audit) throw new Error('audit command not found');
    const list = audit.commands.find((c) => c.name() === 'list');
    if (!list) throw new Error('audit list command not found');
    expect(list.helpInformation()).toMatchSnapshot();
  });

  it('maintenance --help', () => {
    expect(domainHelp(program, 'maintenance')).toMatchSnapshot();
  });
});
