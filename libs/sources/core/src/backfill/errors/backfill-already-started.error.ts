export class BackfillAlreadyStartedError extends Error {
  constructor(daoSourceId: string) {
    super(
      `Backfill already started for dao_source ${daoSourceId}. ` +
        `Use resume mode or clear checkpoint columns first.`,
    );
    this.name = 'BackfillAlreadyStartedError';
  }
}
