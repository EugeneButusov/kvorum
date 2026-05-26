import { describe, expect, it, vi } from 'vitest';
import { MirrorEtlRunRepository } from './mirror-etl-run-repository';

describe('MirrorEtlRunRepository', () => {
  it('returns attempt count when cycle starts', async () => {
    const executeTakeFirstOrThrow = vi.fn().mockResolvedValue({ attempt_count: 2 });
    const returning = vi.fn().mockReturnValue({ executeTakeFirstOrThrow });
    const onConflict = vi.fn().mockReturnValue({ returning });
    const values = vi.fn().mockReturnValue({ onConflict });
    const insertInto = vi.fn().mockReturnValue({ values });
    const repo = new MirrorEtlRunRepository({ insertInto } as never);

    const result = await repo.startCycle({
      job_name: 'vote_events_etl',
      watermark_from: new Date('2026-01-01T00:00:00Z'),
      watermark_to: new Date('2026-01-02T00:00:00Z'),
    });

    expect(result).toEqual({ attempt_count: 2 });
    expect(insertInto).toHaveBeenCalledWith('mirror_etl_run');
    expect(onConflict).toHaveBeenCalledTimes(1);
  });
});
