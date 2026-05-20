export class BootCatchUpShutdownError extends Error {
  constructor() {
    super('boot catch-up cancelled by shutdown');
  }
}
