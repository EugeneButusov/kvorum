export interface ArchiveWriteContext {
  daoSourceId: string;
  sourceType: string;
  chainId: string;
  sourceLabel: string;
}

export type ArchiveWriteOutcome = {
  result: 'inserted' | 'skipped_existing' | 'skipped_conflict' | 'dlq_routed' | 'unreachable';
};
