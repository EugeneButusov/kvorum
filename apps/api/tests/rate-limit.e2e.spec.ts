import { Controller, Get, Module } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { HttpModule } from '../src/http/http.module';
import { RateLimitModule } from '../src/rate-limit/rate-limit.module';
import {
  RateLimiterService,
  RedisUnavailableError,
  type RateLimitResult,
} from '../src/rate-limit/rate-limiter.service';

const describeHttpIf = process.env.NEST_HTTP_TESTS === '1' ? describe : describe.skip;

@Controller()
class TestController {
  @Get('limited')
  limited() {
    return { ok: true };
  }
}

@Module({
  imports: [HttpModule, RateLimitModule],
  controllers: [TestController],
})
class TestRateLimitAppModule {}

describeHttpIf('rate-limit headers e2e', () => {
  async function createAppWithConsume(
    consume: () => Promise<RateLimitResult>,
  ): Promise<INestApplication> {
    const moduleRef = await Test.createTestingModule({
      imports: [TestRateLimitAppModule],
    })
      .overrideProvider(RateLimiterService)
      .useValue({ consume })
      .compile();

    const app = moduleRef.createNestApplication();
    app.use((req: Record<string, unknown>, _res: unknown, next: () => void) => {
      req.apiKey = { id: 'k1', tier: 'authenticated_free' };
      next();
    });
    await app.init();
    return app;
  }

  it('keeps RateLimit-* and Retry-After headers on 429', async () => {
    const app = await createAppWithConsume(async () => ({
      allowed: false,
      limit: 60,
      remaining: 0,
      resetSeconds: 20,
      retryAfterSeconds: 20,
      bindingWindow: 'minute',
    }));

    try {
      const response = await request(app.getHttpServer()).get('/limited');

      expect(response.status).toBe(429);
      expect(response.headers['ratelimit-limit']).toBe('60');
      expect(response.headers['ratelimit-remaining']).toBe('0');
      expect(response.headers['ratelimit-reset']).toBe('20');
      expect(response.headers['retry-after']).toBe('20');
      expect(response.headers['content-type']).toContain('application/problem+json');
      expect(response.body.type).toBe('https://kvorum.example/errors/rate-limited');
    } finally {
      await app.close();
    }
  });

  it('keeps Retry-After header on 503', async () => {
    const app = await createAppWithConsume(async () => {
      throw new RedisUnavailableError(new Error('down'));
    });

    try {
      const response = await request(app.getHttpServer()).get('/limited');

      expect(response.status).toBe(503);
      expect(response.headers['retry-after']).toBe('5');
      expect(response.headers['content-type']).toContain('application/problem+json');
      expect(response.body.type).toBe('https://kvorum.example/errors/service-unavailable');
    } finally {
      await app.close();
    }
  });
});
