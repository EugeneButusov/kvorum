import type { LogEvent } from '@libs/chain';
import { BaseArchiveWriter } from '@sources/core';
import type { ArchiveWriteContext } from '@sources/core';
import type { AaveGovernorV2ArchiveWriterDeps } from './archive-writer.types';
import type { AaveGovernorV2Event } from '../domain/types';

export class AaveGovernorV2ArchiveWriter extends BaseArchiveWriter<AaveGovernorV2Event> {
  private readonly eventRepo: AaveGovernorV2ArchiveWriterDeps['eventRepo'];

  constructor(deps: AaveGovernorV2ArchiveWriterDeps) {
    super(
      deps.archiveEventRepo,
      deps.dlqRepo,
      deps.logger,
      'aave_governor_v2_archive_write',
      deps.now,
    );
    this.eventRepo = deps.eventRepo;
  }

  protected async insertEvent(
    ctx: ArchiveWriteContext,
    decoded: AaveGovernorV2Event,
    logRef: LogEvent,
  ): Promise<void> {
    await this.eventRepo.insert({
      daoSourceId: ctx.daoSourceId,
      chainId: ctx.chainId,
      blockNumber: logRef.blockNumber.toString(),
      blockHash: logRef.blockHash,
      txHash: logRef.txHash,
      logIndex: logRef.logIndex,
      eventType: decoded.type,
      payload: JSON.stringify(decoded.payload),
    });
  }
}
