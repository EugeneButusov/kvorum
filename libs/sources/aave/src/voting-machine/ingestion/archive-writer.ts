import type { LogEvent } from '@libs/chain';
import { BaseArchiveWriter } from '@sources/core';
import type { ArchiveWriteContext } from '@sources/core';
import type { AaveVotingMachineArchiveWriterDeps } from './archive-writer.types';
import type { AaveVotingMachineEvent } from '../domain/types';

export class AaveVotingMachineArchiveWriter extends BaseArchiveWriter<AaveVotingMachineEvent> {
  private readonly eventRepo: AaveVotingMachineArchiveWriterDeps['eventRepo'];

  constructor(deps: AaveVotingMachineArchiveWriterDeps) {
    super(deps.archiveEventRepo, deps.dlqRepo, deps.logger, 'archive_event_stage', deps.now);
    this.eventRepo = deps.eventRepo;
  }

  protected async insertEvent(
    ctx: ArchiveWriteContext,
    decoded: AaveVotingMachineEvent,
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
