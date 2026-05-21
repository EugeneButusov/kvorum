import { Module } from '@nestjs/common';
import { chainMetrics } from '@libs/chain';
import type { EventsListener, LogEvent } from '@libs/chain';
import { ConfirmationRepository, DlqRepository, pgDb } from '@libs/db';
import type { NewArchiveConfirmation, NewIngestionDlq } from '@libs/db';
import type { SourceContext, SourcePlugin } from '@sources/core';
import { SOURCE_PLUGINS } from '@sources/core';
import { PROPOSAL_CREATED_TOPIC } from './evm-test-emitter.bytecode';

@Module({
  providers: [
    {
      provide: SOURCE_PLUGINS,
      useFactory: (): SourcePlugin[] => {
        const confirmationRepo = new ConfirmationRepository(pgDb);
        const dlqRepo = new DlqRepository(pgDb);
        return [
          {
            sourceType: 'evm_test_emitter',
            supportedChainIds: ['0x7a69'],
            parseConfig: (raw) => raw as { governor_address: string },
            buildBackfillRuntime: (ctx, cfg) => ({
              filter: {
                address: (cfg as { governor_address: string }).governor_address.toLowerCase(),
                topics: [[PROPOSAL_CREATED_TOPIC]],
              },
              listenerFactory: () => makeTestListener(ctx, confirmationRepo, dlqRepo),
            }),
            buildIngestSpec: (ctx, cfg) => ({
              kind: 'evm-event-poller' as const,
              filter: {
                address: (cfg as { governor_address: string }).governor_address.toLowerCase(),
                topics: [[PROPOSAL_CREATED_TOPIC]],
              },
              listener: makeTestListener(ctx, confirmationRepo, dlqRepo),
            }),
          },
        ];
      },
    },
  ],
  exports: [SOURCE_PLUGINS],
})
export class TestEvmSourceModule {}

function makeTestListener(
  ctx: SourceContext,
  confirmationRepo: ConfirmationRepository,
  dlqRepo: DlqRepository,
): EventsListener<LogEvent> {
  return async (events) => {
    for (const log of events) {
      const dataBytes = (log.data.length - 2) / 2;
      if (dataBytes < 32) {
        const dlqRow: NewIngestionDlq = {
          stage: 'archive_decode',
          source: ctx.sourceLabel,
          payload: {
            raw: { topics: log.topics, data: log.data },
            block_number: log.blockNumber.toString(),
          },
          error: { name: 'Error', message: 'data_too_short' },
          retries: 0,
          first_seen_at: new Date(),
          last_attempt_at: new Date(),
          archive_source_type: ctx.sourceType,
          archive_chain_id: ctx.chainId,
          archive_tx_hash: log.txHash,
          archive_log_index: log.logIndex,
          archive_block_hash: log.blockHash,
        };
        await dlqRepo.insert(dlqRow);
        chainMetrics.archiveDecodeErrors.add(1, {
          source: ctx.sourceLabel,
          reason: 'data_too_short',
        });
        continue;
      }
      const row: NewArchiveConfirmation = {
        source_type: ctx.sourceType,
        dao_source_id: ctx.daoSourceId,
        chain_id: ctx.chainId,
        block_number: log.blockNumber.toString(),
        block_hash: log.blockHash,
        tx_hash: log.txHash,
        log_index: log.logIndex,
        event_type: 'ProposalCreated',
        received_at: new Date(),
        confirmation_status: 'pending',
      };
      await confirmationRepo.insert(row);
      chainMetrics.archiveWrites.add(1, {
        source: ctx.sourceLabel,
        event_type: 'ProposalCreated',
        result: 'inserted',
      });
    }
  };
}
