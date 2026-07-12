import { describe, expect, it, vi } from 'vitest';
import { AiBatchCycleService } from './ai-batch-cycle.service';
import { AiTriggerScanService } from './ai-trigger-scan.service';

describe('AI schedulers', () => {
  it('scan service calls scanner.run with the trigger lookback', async () => {
    const run = vi.fn().mockResolvedValue(0);
    const svc = new AiTriggerScanService({ run } as never);
    await svc.tick();
    expect(run).toHaveBeenCalledTimes(1);
    expect(typeof run.mock.calls[0][0]).toBe('number');
  });

  it('guards against overlapping ticks (inFlight)', async () => {
    let resolve!: () => void;
    const gate = new Promise<void>((r) => (resolve = r));
    const run = vi.fn().mockReturnValue(gate.then(() => 0));
    const svc = new AiTriggerScanService({ run } as never);

    const first = svc.tick(); // enters, awaits gate
    await svc.tick(); // should early-return without a second run()
    expect(run).toHaveBeenCalledTimes(1);
    resolve();
    await first;
  });

  it('batch cycle calls scanner.run', async () => {
    const run = vi.fn().mockResolvedValue(0);
    const svc = new AiBatchCycleService({ run } as never);
    await svc.tick();
    expect(run).toHaveBeenCalledTimes(1);
  });
});
