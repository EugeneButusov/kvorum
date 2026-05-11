import { provider } from './provider.js';

/**
 * Shuts down the singleton MeterProvider. Callers MUST follow with `vi.resetModules()`
 * and re-import @libs/observability plus any module that built instruments off it.
 */
export async function shutdownForTest(): Promise<void> {
  await provider.shutdown();
}
