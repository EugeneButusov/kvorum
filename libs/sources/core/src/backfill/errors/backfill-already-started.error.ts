export class BackfillAlreadyStartedError extends Error {
  constructor(daoSourceId: string, startedAtBlock: string) {
    super(
      `Cannot start a fresh backfill for dao_source ${daoSourceId}: ` +
        `a backfill is already in progress (started at block ${startedAtBlock}). ` +
        `Pass force=true to clear state and re-capture, or use mode='resume' to continue.`,
    );
    this.name = 'BackfillAlreadyStartedError';
  }
}
