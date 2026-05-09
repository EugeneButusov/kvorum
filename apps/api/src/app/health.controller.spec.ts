import { Test } from '@nestjs/testing';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();
    controller = module.get(HealthController);
  });

  it('returns status ok', () => {
    const result = controller.health();
    expect(result.status).toBe('ok');
    expect(typeof result.timestamp).toBe('string');
  });
});
