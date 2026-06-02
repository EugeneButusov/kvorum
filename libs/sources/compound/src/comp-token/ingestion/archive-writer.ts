import type { LogEvent } from '@libs/chain';
import { BaseArchiveWriter } from '@sources/core';
import type { ArchiveWriteContext } from '@sources/core';
import type { CompTokenArchiveWriterDeps } from './archive-writer.types';
import type { CompTokenEvent } from '../domain/types';

export class CompTokenArchiveWriter extends BaseArchiveWriter<CompTokenEvent> {
  private readonly eventRepo: CompTokenArchiveWriterDeps['eventRepo'];

  constructor(deps: CompTokenArchiveWriterDeps) {
    super(deps.archiveEventRepo, deps.dlqRepo, deps.logger, 'delegation_archive_stage', deps.now);
    this.eventRepo = deps.eventRepo;
  }

  protected async insertEvent(
    ctx: ArchiveWriteContext,
    decoded: CompTokenEvent,
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
