export class BackfillNotResumableError extends Error {
  constructor(daoSourceId: string) {
    super(
      `Cannot resume backfill for dao_source ${daoSourceId}: backfill_started_at_block is null. ` +
        `Run with mode='fresh' to start a new backfill.`,
    );
    this.name = 'BackfillNotResumableError';
  }
}
