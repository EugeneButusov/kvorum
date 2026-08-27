import { UsageRecorderService } from './usage-recorder.service';

function mockRedis() {
  return {
    hincrby: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    pipeline: vi.fn().mockReturnValue({
      hgetall: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([]),
    }),
  };
}

describe('UsageRecorderService', () => {
  describe('record', () => {
    it('calls hincrby with the correct key and today field', () => {
      const redis = mockRedis();
      const svc = new UsageRecorderService(redis as never);

      svc.record('key-1');

      const today = new Date().toISOString().slice(0, 10);
      expect(redis.hincrby).toHaveBeenCalledWith('usage:apikey:key-1', today, 1);
      expect(redis.expire).toHaveBeenCalledWith('usage:apikey:key-1', 31 * 86_400);
    });

    it('swallows hincrby errors', () => {
      const redis = mockRedis();
      redis.hincrby.mockRejectedValue(new Error('down'));
      const svc = new UsageRecorderService(redis as never);

      expect(() => svc.record('key-1')).not.toThrow();
    });

    it('swallows expire errors', () => {
      const redis = mockRedis();
      redis.expire.mockRejectedValue(new Error('down'));
      const svc = new UsageRecorderService(redis as never);

      expect(() => svc.record('key-1')).not.toThrow();
    });
  });

  describe('getDailyUsage', () => {
    it('returns empty map for empty keyIds', async () => {
      const redis = mockRedis();
      const svc = new UsageRecorderService(redis as never);

      const result = await svc.getDailyUsage([], 30);

      expect(result.size).toBe(0);
      expect(redis.pipeline).not.toHaveBeenCalled();
    });

    it('pipelines hgetall for each key and filters by date range', async () => {
      const hgetall = vi.fn().mockReturnThis();
      const today = new Date().toISOString().slice(0, 10);
      const oldDate = '2020-01-01';

      const redis = mockRedis();
      redis.pipeline.mockReturnValue({
        hgetall,
        exec: vi.fn().mockResolvedValue([
          [null, { [today]: '42', [oldDate]: '99' }],
          [null, { [today]: '7' }],
        ]),
      });
      const svc = new UsageRecorderService(redis as never);

      const result = await svc.getDailyUsage(['k1', 'k2'], 30);

      expect(hgetall).toHaveBeenCalledWith('usage:apikey:k1');
      expect(hgetall).toHaveBeenCalledWith('usage:apikey:k2');
      expect(result.get('k1')).toEqual({ [today]: 42 });
      expect(result.get('k2')).toEqual({ [today]: 7 });
    });

    it('handles null pipeline results gracefully', async () => {
      const redis = mockRedis();
      redis.pipeline.mockReturnValue({
        hgetall: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([[null, null]]),
      });
      const svc = new UsageRecorderService(redis as never);

      const result = await svc.getDailyUsage(['k1'], 30);

      expect(result.get('k1')).toEqual({});
    });
  });
});
