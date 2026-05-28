import { CommanderError, Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActorNotFoundForAddressError } from '@libs/db';
import { registerActor } from './actor.js';

const container = {
  actorMergeRepository: {
    planMerge: vi.fn(),
    executeMerge: vi.fn(),
  },
  actorRepository: {
    findActorOverview: vi.fn(),
  },
  adminAuditRepository: {
    start: vi.fn(),
    complete: vi.fn(),
  },
};

vi.mock('../bootstrap.js', () => ({
  buildContainer: () => container,
}));

class ExitSignal extends Error {
  constructor(public readonly code: number) {
    super(`process.exit(${code})`);
  }
}

function buildProgram(): Command {
  const program = new Command();
  program
    .name('admin-cli')
    .description('Kvorum operator administration CLI')
    .option('-f, --format <format>', 'output format: human or json', 'human')
    .helpCommand(true)
    .exitOverride();
  registerActor(program);
  return program;
}

function captureOutput() {
  let stdout = '';
  let stderr = '';
  const stdoutSpy = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation((chunk: string | Uint8Array) => {
      stdout += String(chunk);
      return true;
    });
  const stderrSpy = vi
    .spyOn(process.stderr, 'write')
    .mockImplementation((chunk: string | Uint8Array) => {
      stderr += String(chunk);
      return true;
    });
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new ExitSignal(Number(code ?? 0));
  }) as never);

  return {
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    },
    stdoutSpy,
    stderrSpy,
    exitSpy,
  };
}

async function runCommand(args: string[]) {
  const output = captureOutput();
  const program = buildProgram();

  try {
    await program.parseAsync(args, { from: 'user' });
    return { code: 0, stdout: output.stdout, stderr: output.stderr };
  } catch (error) {
    if (error instanceof ExitSignal) {
      return { code: error.code, stdout: output.stdout, stderr: output.stderr };
    }
    if (error instanceof CommanderError) {
      return {
        code: error.exitCode ?? 1,
        stdout: output.stdout,
        stderr: output.stderr,
        error,
      };
    }
    throw error;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  container.actorMergeRepository.planMerge.mockReset();
  container.actorMergeRepository.executeMerge.mockReset();
  container.actorRepository.findActorOverview.mockReset();
  container.adminAuditRepository.start.mockReset();
  container.adminAuditRepository.complete.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('actors command surface', () => {
  it('renders a dry-run merge plan and brackets the call in audit rows', async () => {
    container.adminAuditRepository.start.mockResolvedValue('audit-1');
    container.adminAuditRepository.complete.mockResolvedValue(undefined);
    container.actorMergeRepository.planMerge.mockResolvedValue({
      survivor: { actorId: 'actor-1', primaryAddress: '0x' + '1'.repeat(40) },
      secondary: { actorId: 'actor-2', primaryAddress: '0x' + '2'.repeat(40) },
      proposalProposerRewrites: 3,
      actorAddressRetargets: 4,
      actorAddressPrimaryFlip: { address: '0x' + '2'.repeat(40), willFlipIsPrimary: true },
      redirectsToFlatten: [],
      redirectToInsert: { from_address: '0x' + '2'.repeat(40), to_actor_id: 'actor-1' },
    });

    const result = await runCommand([
      'actors',
      'merge',
      '0x' + '1'.repeat(40),
      '0x' + '2'.repeat(40),
      '--reason',
      'same delegate',
      '--dry-run',
    ]);

    expect(result.code).toBe(0);
    expect(container.actorMergeRepository.planMerge).toHaveBeenCalledWith({
      primaryAddress: '0x' + '1'.repeat(40),
      secondaryAddress: '0x' + '2'.repeat(40),
    });
    expect(container.actorMergeRepository.executeMerge).not.toHaveBeenCalled();
    expect(container.adminAuditRepository.start).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'actors merge',
        args: expect.objectContaining({
          dry_run: true,
          reason: 'same delegate',
        }),
      }),
    );
    expect(container.adminAuditRepository.complete).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'success' }),
    );
    expect(result.stdout).toMatchInlineSnapshot(`
"Merge plan (DRY RUN - no DB changes):

  Survivor:  primary_address=0x1111111111111111111111111111111111111111  actor_id=actor-1
  Secondary: primary_address=0x2222222222222222222222222222222222222222  actor_id=actor-2

  FK rewrites: 3 rows (proposal proposer)

  actor_address rows retargeted: 4
  (former primary 0x2222222222222222222222222222222222222222 will be flipped to is_primary=false)

  Redirects to flatten: 0
  Redirect to insert: 0x2222222222222222222222222222222222222222 -> actor_id=actor-1

  Secondary actor actor-2 will be marked merged_into_actor_id=actor-1

  Pass --confirm to apply.
"
`);
  });

  it('runs a live merge with normalized addresses and created-by identity', async () => {
    container.adminAuditRepository.start.mockResolvedValue('audit-2');
    container.adminAuditRepository.complete.mockResolvedValue(undefined);
    container.actorMergeRepository.executeMerge.mockResolvedValue({
      survivor: { actorId: 'actor-1', primaryAddress: '0x' + '1'.repeat(40) },
      secondary: { actorId: 'actor-2', primaryAddress: '0x' + '2'.repeat(40) },
      proposalProposerRewrites: 1,
      actorAddressRetargets: 6,
      redirectsToFlatten: [],
      redirectToInsert: { from_address: '0x' + '2'.repeat(40), to_actor_id: 'actor-1' },
      appliedAt: new Date('2026-05-24T12:34:56Z'),
    });

    const result = await runCommand([
      'actors',
      'merge',
      '0x' + 'A'.repeat(40),
      '0x' + 'b'.repeat(40),
      '--reason',
      'same delegate',
      '--confirm',
    ]);

    expect(result.code).toBe(0);
    expect(container.actorMergeRepository.executeMerge).toHaveBeenCalledWith(
      expect.objectContaining({
        primaryAddress: '0x' + 'a'.repeat(40),
        secondaryAddress: '0x' + 'b'.repeat(40),
        mergeReason: 'same delegate',
        createdBy: expect.any(String),
      }),
    );
    expect(result.stdout).toContain('Merge applied:');
    expect(result.stdout).toContain('Applied at: 2026-05-24T12:34:56.000Z');
  });

  it('maps repository not-found errors to exit code 3', async () => {
    container.adminAuditRepository.start.mockResolvedValue('audit-3');
    container.adminAuditRepository.complete.mockResolvedValue(undefined);
    container.actorMergeRepository.executeMerge.mockRejectedValue(
      new ActorNotFoundForAddressError('0x' + '2'.repeat(40)),
    );

    const result = await runCommand([
      'actors',
      'merge',
      '0x' + '1'.repeat(40),
      '0x' + '2'.repeat(40),
      '--reason',
      'same delegate',
      '--confirm',
    ]);

    expect(result.code).toBe(3);
    expect(result.stderr).toContain('actor not found for address');
    expect(container.adminAuditRepository.complete).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failure' }),
    );
  });

  it('shows actor state in JSON', async () => {
    container.actorRepository.findActorOverview.mockResolvedValue({
      actorId: 'actor-1',
      primaryAddress: '0x' + '1'.repeat(40),
      addresses: [
        { address: '0x' + '1'.repeat(40), isPrimary: true, source: 'manual' },
        { address: '0x' + '2'.repeat(40), isPrimary: false, source: 'merge_redirect' },
      ],
      mergedIntoActorId: null,
      inboundRedirects: [
        {
          fromAddress: '0x' + '3'.repeat(40),
          toActorId: 'actor-1',
          mergedAt: new Date('2026-05-23T00:00:00Z'),
          mergeReason: 'delegate consolidation',
          createdBy: 'alice',
        },
      ],
    });

    const result = await runCommand(['actors', 'show', '0x' + '1'.repeat(40), '--format', 'json']);

    expect(result.code).toBe(0);
    expect(container.actorRepository.findActorOverview).toHaveBeenCalledWith('0x' + '1'.repeat(40));
    expect(JSON.parse(result.stdout)).toMatchObject({
      actorId: 'actor-1',
      primaryAddress: '0x' + '1'.repeat(40),
      mergedIntoActorId: null,
    });
  });

  it('returns not found for missing actor overview', async () => {
    container.actorRepository.findActorOverview.mockResolvedValue(null);

    const result = await runCommand(['actors', 'show', '0x' + '1'.repeat(40)]);

    expect(result.code).toBe(3);
    expect(result.stderr).toContain('no actor found for address');
  });
});
