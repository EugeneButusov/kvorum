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

  it('daos --help', () => {
    expect(domainHelp(program, 'daos')).toMatchSnapshot();
  });

  it('daos source --help', () => {
    expect(subHelp(program, 'daos', 'source')).toMatchSnapshot();
  });

  it('backfill --help', () => {
    expect(domainHelp(program, 'backfill')).toMatchSnapshot();
  });

  it('derive --help', () => {
    expect(domainHelp(program, 'derive')).toMatchSnapshot();
  });

  it('actors --help', () => {
    expect(domainHelp(program, 'actors')).toMatchSnapshot();
  });

  it('dlq --help', () => {
    expect(domainHelp(program, 'dlq')).toMatchSnapshot();
  });

  it('ai --help', () => {
    expect(domainHelp(program, 'ai')).toMatchSnapshot();
  });

  it('users --help', () => {
    expect(domainHelp(program, 'users')).toMatchSnapshot();
  });

  it('keys --help', () => {
    expect(domainHelp(program, 'keys')).toMatchSnapshot();
  });

  it('reorgs --help', () => {
    expect(domainHelp(program, 'reorgs')).toMatchSnapshot();
  });

  it('status --help', () => {
    expect(domainHelp(program, 'status')).toMatchSnapshot();
  });

  it('audits --help', () => {
    expect(domainHelp(program, 'audits')).toMatchSnapshot();
  });

  it('audits list --help', () => {
    const audits = program.commands.find((c) => c.name() === 'audits');
    if (!audits) throw new Error('audits command not found');
    const list = audits.commands.find((c) => c.name() === 'list');
    if (!list) throw new Error('audits list command not found');
    expect(list.helpInformation()).toMatchSnapshot();
  });

  it('maintenance --help', () => {
    expect(domainHelp(program, 'maintenance')).toMatchSnapshot();
  });
});
