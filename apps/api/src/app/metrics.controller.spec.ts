import { Test } from '@nestjs/testing';
import { vi } from 'vitest';
import { MetricsController } from './metrics.controller';

vi.mock('@libs/observability', () => ({
  renderMetrics: vi.fn().mockResolvedValue('# mock metrics\n'),
}));

describe('MetricsController', () => {
  let controller: MetricsController;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [MetricsController],
    }).compile();
    controller = module.get(MetricsController);
  });

  it('returns string output from renderMetrics()', async () => {
    const result = await controller.metrics();
    expect(typeof result).toBe('string');
    expect(result).toContain('mock metrics');
  });
});
