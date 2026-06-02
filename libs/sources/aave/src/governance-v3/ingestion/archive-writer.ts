import type { LogEvent } from '@libs/chain';
import { BaseArchiveWriter } from '@sources/core';
import type { ArchiveWriteContext } from '@sources/core';
import type { AaveGovernanceArchiveWriterDeps } from './archive-writer.types';
import type { AaveGovernanceV3Event } from '../domain/types';

export class AaveGovernanceArchiveWriter extends BaseArchiveWriter<AaveGovernanceV3Event> {
  private readonly eventRepo: AaveGovernanceArchiveWriterDeps['eventRepo'];

  constructor(deps: AaveGovernanceArchiveWriterDeps) {
    super(deps.archiveEventRepo, deps.dlqRepo, deps.logger, 'archive_event_stage', deps.now);
    this.eventRepo = deps.eventRepo;
  }

  protected async insertEvent(
    ctx: ArchiveWriteContext,
    decoded: AaveGovernanceV3Event,
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
