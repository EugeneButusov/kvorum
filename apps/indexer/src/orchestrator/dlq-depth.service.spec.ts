import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chainMetrics } from '@libs/chain';
import type { DlqDepthRow } from '@libs/db';
import { DlqDepthService } from './dlq-depth.service';

vi.mock('@libs/chain', () => ({
  chainMetrics: {
    dlqDepth: { record: vi.fn() },
  },
}));

// Minimal DlqRepository stub — returns scripted sequences
function makeRepo(sequences: DlqDepthRow[][]): {
  depthByStageAndSource: () => Promise<DlqDepthRow[]>;
} {
  let call = 0;
  return {
    depthByStageAndSource: async () => sequences[call++] ?? [],
  };
}

describe('DlqDepthService drain semantics', () => {
  const recordFn = () => vi.mocked(chainMetrics.dlqDepth.record);

  beforeEach(() => {
    recordFn().mockClear();
  });

  it('records count for each series returned by the query', async () => {
    const repo = makeRepo([[{ stage: 'archive_decode', source: 'compound_governor', count: 3 }]]);
    const svc = new DlqDepthService(repo as never);
    await (svc as unknown as { tick: () => Promise<void> }).tick();

    expect(recordFn()).toHaveBeenCalledWith(3, {
      stage: 'archive_decode',
      source: 'compound_governor',
    });
  });

  it('emits 0 for a series that drops out of subsequent SELECT results (drain semantics)', async () => {
    const repo = makeRepo([
      [{ stage: 'archive_decode', source: 'compound_governor', count: 1 }],
      [], // second tick: no rows (series drained)
    ]);
    const svc = new DlqDepthService(repo as never);

    await (svc as unknown as { tick: () => Promise<void> }).tick();
    recordFn().mockClear();

    await (svc as unknown as { tick: () => Promise<void> }).tick();
    expect(recordFn()).toHaveBeenCalledWith(0, {
      stage: 'archive_decode',
      source: 'compound_governor',
    });
  });

  it('independently tracks a second series appearing in a later tick', async () => {
    const repo = makeRepo([
      [{ stage: 'archive_decode', source: 'compound_governor', count: 1 }],
      [
        { stage: 'archive_decode', source: 'compound_governor', count: 0 },
        { stage: 'archive_confirmation_write', source: 'compound_governor', count: 3 },
      ],
    ]);
    const svc = new DlqDepthService(repo as never);

    await (svc as unknown as { tick: () => Promise<void> }).tick();
    recordFn().mockClear();

    await (svc as unknown as { tick: () => Promise<void> }).tick();
    expect(recordFn()).toHaveBeenCalledWith(0, {
      stage: 'archive_decode',
      source: 'compound_governor',
    });
    expect(recordFn()).toHaveBeenCalledWith(3, {
      stage: 'archive_confirmation_write',
      source: 'compound_governor',
    });
  });
});
