import type { LogEvent } from '@libs/chain';
import { BaseArchiveWriter } from '@sources/core';
import type { ArchiveWriteContext } from '@sources/core';
import type { DelegateRegistryArchiveWriterDeps } from './archive-writer.types';
import type { DelegateRegistryEvent } from '../domain/types';

export class DelegateRegistryArchiveWriter extends BaseArchiveWriter<DelegateRegistryEvent> {
  private readonly eventRepo: DelegateRegistryArchiveWriterDeps['eventRepo'];

  constructor(deps: DelegateRegistryArchiveWriterDeps) {
    super(deps.archiveEventRepo, deps.dlqRepo, deps.logger, 'archive_event_stage', deps.now);
    this.eventRepo = deps.eventRepo;
  }

  protected async insertEvent(
    ctx: ArchiveWriteContext,
    decoded: DelegateRegistryEvent,
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
