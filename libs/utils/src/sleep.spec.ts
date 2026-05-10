import { describe, expect, it } from 'vitest';
import { sleep } from './sleep.js';

describe('sleep', () => {
  it('resolves after the requested delay', async () => {
    const t0 = Date.now();
    await sleep(50);
    const elapsed = Date.now() - t0;
    // Allow generous slack for slow CI runners
    expect(elapsed).toBeGreaterThanOrEqual(40);
    expect(elapsed).toBeLessThan(500);
  });

  it('resolves to undefined', async () => {
    const result = await sleep(1);
    expect(result).toBeUndefined();
  });

  it('handles 0 ms (resolves on next tick)', async () => {
    await expect(sleep(0)).resolves.toBeUndefined();
  });
});
