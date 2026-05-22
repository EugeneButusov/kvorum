import { createHash } from 'node:crypto';
import { Command } from 'commander';
import { withAudit } from '../audit.js';
import { buildContainer } from '../bootstrap.js';
import { emit, ExitCode, fail, type OutputFormat, resolveFormat } from '../output.js';

type DeriveCommon = { format?: string };
type DeriveReplayOptions = DeriveCommon & {
  fromBlock?: string;
  confirm?: boolean;
  production?: boolean;
  dryRun?: boolean;
};

export function registerDerive(program: Command): void {
  const derive = program.command('derive').description('Derived data management');

  derive
    .command('replay <dao_source_id>')
    .description('Replay derivation for a DAO source (destructive)')
    .option('--from-block <N>', 'starting block number')
    .option('--confirm', 'confirm destructive operation')
    .option('--production', 'acknowledge production environment')
    .option('--dry-run', 'show what would happen without making changes')
    .option('--format <format>', 'output format: human or json')
    .action(async function action(daoSourceId: string, opts: DeriveReplayOptions) {
      await withDeriveFormat(this, opts, async (format) => {
        const { archiveDerivationRepository } = buildContainer();
        const fromBlock = parseOptionalBlock(opts.fromBlock, '--from-block');

        if (opts.dryRun === true) {
          const rows = await archiveDerivationRepository.countConfirmedUnderived(
            daoSourceId,
            fromBlock,
          );
          emit(format, () => `Would reset derivation watermark for ${rows} rows`, {
            dao_source_id: daoSourceId,
            dry_run: true,
            affected_rows: rows,
          });
          return;
        }

        if (opts.confirm !== true || opts.production !== true) {
          fail(
            format,
            ExitCode.ValidationFailure,
            'derive replay requires both --confirm and --production',
          );
        }

        await withAudit('derive replay', { daoSourceId, ...opts }, async () => {
          const count = await archiveDerivationRepository.resetWatermarkForSource(
            daoSourceId,
            fromBlock,
          );
          emit(
            format,
            () =>
              `Watermarks reset (${count} rows); re-derivation occurs as the indexer processes them`,
            {
              dao_source_id: daoSourceId,
              reset_rows: count,
              note: 'Resets watermarks only; running indexer performs re-derivation',
            },
          );
        });
      });
    });

  derive
    .command('verify <proposal_external_id>')
    .description('Verify derived data for a proposal')
    .option('--format <format>', 'output format: human or json')
    .action(async function action(proposalExternalId: string, opts: DeriveCommon) {
      await withDeriveFormat(this, opts, async (format) => {
        const [daoSlug, sourceType, sourceId] = proposalExternalId.split(':');
        if (!daoSlug || !sourceType || !sourceId) {
          fail(
            format,
            ExitCode.ValidationFailure,
            'proposal_external_id must be dao_slug:source_type:source_id',
          );
        }

        const { daoReadRepository, proposalReadRepository } = buildContainer();
        const proposal = await proposalReadRepository.findOne(daoSlug, sourceType, sourceId);
        if (proposal == null) {
          fail(format, ExitCode.NotFound, `proposal not found: ${proposalExternalId}`);
        }

        const daoSource = await daoReadRepository.findSourceByDaoSlugAndType(daoSlug, sourceType);
        if (daoSource == null) {
          fail(format, ExitCode.NotFound, `dao source not found for ${daoSlug}:${sourceType}`);
        }

        const { compoundGovernorArchivePayloadRepository } = buildContainer();
        const archived = await compoundGovernorArchivePayloadRepository.findByProposalId(
          daoSource.id,
          sourceId,
        );

        const created = archived.find((row) => row.event_type === 'ProposalCreated');
        if (created == null) {
          fail(
            format,
            ExitCode.RuntimeFailure,
            `no ProposalCreated archive event found for ${proposalExternalId}`,
          );
        }

        const createdPayload = JSON.parse(created.payload) as {
          description: string;
          startBlock: string;
          endBlock: string;
        };

        const { extractCompoundTitle } = await import('@sources/compound');
        const expectedTitle = extractCompoundTitle(createdPayload.description);
        const expectedDescriptionHash = createHash('sha256')
          .update(createdPayload.description)
          .digest('hex');
        const transition = archived
          .filter((row) =>
            ['ProposalQueued', 'ProposalExecuted', 'ProposalCanceled'].includes(row.event_type),
          )
          .at(-1);
        const expectedState =
          transition?.event_type === 'ProposalExecuted'
            ? 'executed'
            : transition?.event_type === 'ProposalQueued'
              ? 'queued'
              : transition?.event_type === 'ProposalCanceled'
                ? 'canceled'
                : 'pending';

        const diffs: string[] = [];
        if (proposal.title !== expectedTitle) diffs.push('title');
        if (proposal.description_hash !== expectedDescriptionHash) diffs.push('description_hash');
        if (proposal.voting_starts_block !== createdPayload.startBlock)
          diffs.push('voting_starts_block');
        if (proposal.voting_ends_block !== createdPayload.endBlock) diffs.push('voting_ends_block');
        if (proposal.state !== expectedState) diffs.push('state');

        const payload = {
          proposal_external_id: proposalExternalId,
          ok: diffs.length === 0,
          diff_fields: diffs,
          scope: 'verifies proposal-row fields only; does not re-decode actions',
        };

        emit(
          format,
          () =>
            diffs.length === 0
              ? `Verification passed (${payload.scope})`
              : `Verification failed; differing fields: ${diffs.join(', ')} (${payload.scope})`,
          payload,
        );
      });
    });
}

function parseOptionalBlock(value: string | undefined, optionName: string): bigint | undefined {
  if (value == null) {
    return undefined;
  }
  if (!/^\d+$/.test(value)) {
    throw new Error(`${optionName} must be an unsigned integer`);
  }
  return BigInt(value);
}

async function withDeriveFormat(
  command: Command,
  opts: DeriveCommon,
  run: (format: OutputFormat) => Promise<void>,
): Promise<void> {
  let format: OutputFormat = 'human';
  try {
    const globalFormat = command.optsWithGlobals()['format'];
    format = resolveFormat(
      opts.format,
      typeof globalFormat === 'string' ? globalFormat : undefined,
    );
    await run(format);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    if (
      message.startsWith('invalid --format value:') ||
      message.includes('must be an unsigned integer')
    ) {
      fail(opts.format === 'json' ? 'json' : 'human', ExitCode.ValidationFailure, message);
    }
    fail(format, ExitCode.RuntimeFailure, 'derive command failed', { message });
  }
}
