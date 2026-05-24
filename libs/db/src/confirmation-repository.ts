import { ArchiveEventRepository, type ArchiveEventKey } from './archive-event-repository';

export interface ConfirmationKey {
  sourceType: string;
  chainId: string;
  txHash: string;
  logIndex: number;
  blockHash?: string;
}

export class ConfirmationRepository extends ArchiveEventRepository {
  override async find(key: ConfirmationKey): Promise<{ id: string } | undefined> {
    return super.find(key as ArchiveEventKey);
  }

  async countPendingBySourceType(sourceType: string) {
    return super.countUnderivedBySourceType(sourceType);
  }
}
