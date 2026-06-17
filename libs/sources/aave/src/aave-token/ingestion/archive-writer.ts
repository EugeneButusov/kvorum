import type { LogEvent } from '@libs/chain';
import { BaseArchiveWriter } from '@sources/core';
import type { ArchiveWriteContext } from '@sources/core';
import type { AaveTokenArchiveWriterDeps } from './archive-writer.types';
import type { AaveTokenEvent } from '../domain/types';

export class AaveTokenArchiveWriter extends BaseArchiveWriter<AaveTokenEvent> {
  private readonly eventRepo: AaveTokenArchiveWriterDeps['eventRepo'];

  constructor(deps: AaveTokenArchiveWriterDeps) {
    super(deps.archiveEventRepo, deps.dlqRepo, deps.logger, 'archive_event_stage', deps.now);
    this.eventRepo = deps.eventRepo;
  }

  protected async insertEvent(
    ctx: ArchiveWriteContext,
    decoded: AaveTokenEvent,
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
