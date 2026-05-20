export class DaoSourceNotFoundError extends Error {
  constructor(daoSourceId: string) {
    super(`dao_source ${daoSourceId} not found`);
  }
}
