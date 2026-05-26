import { describe, expect, it, vi } from 'vitest';
import { MirrorEtlWatermarkRepository } from './mirror-etl-watermark-repository';

describe('MirrorEtlWatermarkRepository', () => {
  it('finds watermark by job name', async () => {
    const executeTakeFirst = vi
      .fn()
      .mockResolvedValue({ watermark: new Date('2026-01-01T00:00:00Z') });
    const where = vi.fn().mockReturnValue({ executeTakeFirst });
    const select = vi.fn().mockReturnValue({ where });
    const selectFrom = vi.fn().mockReturnValue({ select });
    const repo = new MirrorEtlWatermarkRepository({ selectFrom } as never);

    const watermark = await repo.findByName('vote_events_etl');

    expect(watermark?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(selectFrom).toHaveBeenCalledWith('etl_watermark');
    expect(select).toHaveBeenCalledWith('watermark');
    expect(where).toHaveBeenCalledWith('job_name', '=', 'vote_events_etl');
  });
});
