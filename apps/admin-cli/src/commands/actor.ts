import { Command } from 'commander';
import { withAudit } from '../audit.js';
import { buildContainer } from '../bootstrap.js';
import {
  emit,
  emitNotImplemented,
  ExitCode,
  fail,
  type OutputFormat,
  resolveFormat,
} from '../output.js';
import {
  ActorAddressCollisionError,
  ActorAlreadyMergedError,
  ActorNotFoundForAddressError,
  SameActorMergeError,
} from '@libs/db';

const REASON_MAX_BYTES = 4096;
const ADDRESS_PATTERN = /^0x[a-f0-9]{40}$/;

type MergeOpts = {
  reason: string;
  confirm?: boolean;
  production?: boolean;
  dryRun?: boolean;
  format?: string;
};

type ShowOpts = {
  format?: string;
};

export function registerActor(program: Command): void {
  const actor = program.command('actors').description('Actor management');

  actor
    .command('merge <primary_address> <secondary_address>')
    .description('Merge two actor identities (destructive)')
    .requiredOption('--reason <text>', 'human-readable rationale for the merge (required, max 4KB)')
    .option('--confirm', 'confirm destructive operation')
    .option('--production', 'acknowledge production environment')
    .option('--dry-run', 'show what would happen without making changes')
    .option('--format <format>', 'output format: human or json')
    .action(async function action(primary: string, secondary: string, opts: MergeOpts) {
      await withActorFormat(this, opts, async (format) => {
        validateAddressShape(primary, '<primary_address>', format);
        validateAddressShape(secondary, '<secondary_address>', format);

        const primaryAddress = primary.toLowerCase();
        const secondaryAddress = secondary.toLowerCase();
        const reason = opts.reason.trim();
        if (reason.length === 0) {
          fail(format, ExitCode.ValidationFailure, '--reason must be non-empty');
        }
        if (Buffer.byteLength(reason, 'utf8') > REASON_MAX_BYTES) {
          fail(
            format,
            ExitCode.ValidationFailure,
            '--reason exceeds 4KB; link to evidence rather than pasting it',
          );
        }

        const isDryRun = opts.dryRun === true;
        if (!isDryRun && opts.confirm !== true) {
          fail(
            format,
            ExitCode.ValidationFailure,
            '--confirm is required for the live merge (or use --dry-run)',
          );
        }
        if (!isDryRun && process.env['NODE_ENV'] === 'production' && opts.production !== true) {
          fail(format, ExitCode.ValidationFailure, '--production is required in production');
        }

        const { actorMergeRepository } = buildContainer();
        const auditArgs = {
          primary_address: primaryAddress,
          secondary_address: secondaryAddress,
          reason,
          dry_run: isDryRun,
        };

        try {
          await withAudit('actors merge', auditArgs, async () => {
            if (isDryRun) {
              const plan = await actorMergeRepository.planMerge({
                primaryAddress,
                secondaryAddress,
              });
              emit(format, () => renderPlanHuman(plan), { dry_run: true, ...plan });
              return;
            }

            const createdBy = resolveCreatedBy();
            const result = await actorMergeRepository.executeMerge({
              primaryAddress,
              secondaryAddress,
              mergeReason: reason,
              createdBy,
            });
            emit(format, () => renderResultHuman(result, reason), { dry_run: false, ...result });
          });
        } catch (error) {
          handleMergeError(error, format);
        }
      });
    });

  actor
    .command('show <address>')
    .description('Show actor identity, addresses, merge state, and inbound redirects')
    .option('--format <format>', 'output format: human or json')
    .action(async function action(address: string, opts: ShowOpts) {
      await withActorFormat(this, opts, async (format) => {
        validateAddressShape(address, '<address>', format);
        const normalized = address.toLowerCase();
        const { actorRepository } = buildContainer();
        const overview = await actorRepository.findActorOverview(normalized);
        if (overview == null) {
          fail(format, ExitCode.NotFound, `no actor found for address: ${normalized}`);
        }

        emit(format, () => renderOverviewHuman(overview), overview);
      });
    });

  const address = actor.command('address').description('Actor address management');
  address
    .command('add <actor_id> <address>')
    .description('Add an address to an actor')
    .requiredOption('--source <source>', 'address source')
    .option('--dry-run', 'show what would happen without making changes')
    .option('--format <format>', 'output format: human or json')
    .action((_actor_id, _address, opts) => emitNotImplemented('actors address add', opts));
}

function validateAddressShape(address: string, optionName: string, format: OutputFormat): void {
  if (!ADDRESS_PATTERN.test(address.toLowerCase())) {
    fail(
      format,
      ExitCode.ValidationFailure,
      `${optionName} must be a 0x-prefixed 40-byte hex address`,
    );
  }
}

async function withActorFormat(
  command: Command,
  opts: { format?: string },
  run: (format: OutputFormat) => Promise<void>,
): Promise<void> {
  try {
    const globalFormat = command.optsWithGlobals()['format'];
    const format = resolveFormat(
      opts.format,
      typeof globalFormat === 'string' ? globalFormat : undefined,
    );
    await run(format);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    if (message.startsWith('invalid --format value:')) {
      fail(opts.format === 'json' ? 'json' : 'human', ExitCode.ValidationFailure, message);
    }
    throw error;
  }
}

function handleMergeError(error: unknown, format: OutputFormat): never {
  if (error instanceof ActorNotFoundForAddressError) {
    fail(format, ExitCode.NotFound, error.message, { address: error.address });
  }
  if (error instanceof ActorAlreadyMergedError) {
    fail(format, ExitCode.ValidationFailure, error.message, {
      address: error.address,
      merged_into_actor_id: error.mergedIntoActorId,
    });
  }
  if (error instanceof SameActorMergeError) {
    fail(format, ExitCode.ValidationFailure, error.message, {
      primary_address: error.primaryAddress,
      secondary_address: error.secondaryAddress,
      actor_id: error.actorId,
    });
  }
  if (error instanceof ActorAddressCollisionError) {
    fail(format, ExitCode.ValidationFailure, error.message, {
      address: error.address,
      survivor_actor_id: error.survivorActorId,
    });
  }

  const message = error instanceof Error ? error.message : 'unknown error';
  fail(format, ExitCode.RuntimeFailure, 'actors merge failed', { message });
}

function resolveCreatedBy(): string {
  const sudoUser = process.env['SUDO_USER'];
  if (sudoUser != null && sudoUser.length > 0) return sudoUser;

  if (process.env['SSH_CONNECTION'] != null || process.env['SSH_CLIENT'] != null) {
    return process.env['USER'] ?? 'unknown';
  }

  const envUser = process.env['USER'] ?? process.env['LOGNAME'];
  if (envUser != null && envUser.length > 0) return envUser;

  return 'unknown';
}

function renderPlanHuman(plan: {
  survivor: { actorId: string; primaryAddress: string };
  secondary: { actorId: string; primaryAddress: string };
  fkRewrites: {
    proposal_proposer_actor_id: number;
    vote_voter_actor_id: number;
    delegation_delegator_actor_id: number;
    delegation_delegate_actor_id: number;
    voting_power_snapshot_actor_id: number;
  };
  actorAddressRetargets: number;
  actorAddressPrimaryFlip: { address: string; willFlipIsPrimary: boolean };
  redirectsToFlatten: Array<{ from_address: string; current_to_actor_id: string }>;
  redirectToInsert: { from_address: string; to_actor_id: string };
}): string {
  const totalFkWrites =
    plan.fkRewrites.proposal_proposer_actor_id +
    plan.fkRewrites.vote_voter_actor_id +
    plan.fkRewrites.delegation_delegator_actor_id +
    plan.fkRewrites.delegation_delegate_actor_id +
    plan.fkRewrites.voting_power_snapshot_actor_id;

  return [
    'Merge plan (DRY RUN - no DB changes):',
    '',
    `  Survivor:  primary_address=${plan.survivor.primaryAddress}  actor_id=${plan.survivor.actorId}`,
    `  Secondary: primary_address=${plan.secondary.primaryAddress}  actor_id=${plan.secondary.actorId}`,
    '',
    '  FK rewrites:',
    `    proposal.proposer_actor_id:        ${plan.fkRewrites.proposal_proposer_actor_id} rows`,
    `    vote.voter_actor_id:               ${plan.fkRewrites.vote_voter_actor_id} rows`,
    `    delegation.delegator_actor_id:     ${plan.fkRewrites.delegation_delegator_actor_id} rows`,
    `    delegation.delegate_actor_id:      ${plan.fkRewrites.delegation_delegate_actor_id} rows`,
    `    voting_power_snapshot.actor_id:     ${plan.fkRewrites.voting_power_snapshot_actor_id} rows`,
    `    total:                              ${totalFkWrites} rows`,
    '',
    `  actor_address rows retargeted: ${plan.actorAddressRetargets}`,
    `  (former primary ${plan.actorAddressPrimaryFlip.address} will be flipped to is_primary=false)`,
    '',
    `  Redirects to flatten: ${plan.redirectsToFlatten.length}`,
    `  Redirect to insert: ${plan.redirectToInsert.from_address} -> actor_id=${plan.redirectToInsert.to_actor_id}`,
    '',
    `  Secondary actor ${plan.secondary.actorId} will be marked merged_into_actor_id=${plan.survivor.actorId}`,
    '',
    '  Pass --confirm to apply.',
  ].join('\n');
}

function renderResultHuman(
  result: {
    survivor: { actorId: string; primaryAddress: string };
    secondary: { actorId: string; primaryAddress: string };
    fkRewrites: {
      proposal_proposer_actor_id: number;
      vote_voter_actor_id: number;
      delegation_delegator_actor_id: number;
      delegation_delegate_actor_id: number;
      voting_power_snapshot_actor_id: number;
    };
    actorAddressRetargets: number;
    redirectsToFlatten: Array<{ from_address: string; current_to_actor_id: string }>;
    redirectToInsert: { from_address: string; to_actor_id: string };
    appliedAt: Date;
  },
  reason: string,
): string {
  const totalFkWrites =
    result.fkRewrites.proposal_proposer_actor_id +
    result.fkRewrites.vote_voter_actor_id +
    result.fkRewrites.delegation_delegator_actor_id +
    result.fkRewrites.delegation_delegate_actor_id +
    result.fkRewrites.voting_power_snapshot_actor_id;

  return [
    'Merge applied:',
    '',
    `  Survivor:  primary_address=${result.survivor.primaryAddress}  actor_id=${result.survivor.actorId}`,
    `  Secondary: primary_address=${result.secondary.primaryAddress}  actor_id=${result.secondary.actorId}`,
    '',
    `  FK rewrites: ${totalFkWrites} rows across 5 tables`,
    `  actor_address rows retargeted: ${result.actorAddressRetargets}`,
    `  Redirect inserted: ${result.redirectToInsert.from_address} -> ${result.redirectToInsert.to_actor_id}`,
    `  Redirects flattened: ${result.redirectsToFlatten.length}`,
    `  Secondary marked merged_into_actor_id=${result.survivor.actorId}`,
    `  Reason: ${reason}`,
    '',
    `  Applied at: ${result.appliedAt.toISOString()}`,
  ].join('\n');
}

function renderOverviewHuman(overview: {
  actorId: string;
  primaryAddress: string;
  addresses: Array<{ address: string; isPrimary: boolean; source: string }>;
  mergedIntoActorId: string | null;
  inboundRedirects: Array<{
    fromAddress: string;
    toActorId: string;
    mergedAt: Date;
    mergeReason: string;
    createdBy: string;
  }>;
}): string {
  const mergeState =
    overview.mergedIntoActorId == null
      ? 'active (not merged)'
      : `merged into ${overview.mergedIntoActorId} (use 'admin-cli actors show 0x...' on the survivor for current state)`;

  return [
    `Actor ${overview.actorId}:`,
    `  Primary address: ${overview.primaryAddress}`,
    '  All addresses:',
    ...overview.addresses.map(
      (row) =>
        `    ${row.address}  (${row.isPrimary ? 'primary' : 'secondary'}, source=${row.source})`,
    ),
    `  Merge state: ${mergeState}`,
    '  Inbound redirects:',
    ...overview.inboundRedirects.map(
      (row) =>
        `    ${row.fromAddress} -> this actor   (merged ${row.mergedAt.toISOString()}; reason: "${row.mergeReason}")`,
    ),
  ].join('\n');
}
