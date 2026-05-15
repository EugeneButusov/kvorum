import { Controller, Get, Module } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { CacheControl } from '../src/cache/cache-control.decorator';
import { CacheModule } from '../src/cache/cache.module';
import { HttpModule } from '../src/http/http.module';

const describeHttpIf = process.env.NEST_HTTP_TESTS === '1' ? describe : describe.skip;

@Controller()
class CacheController {
  @Get('cache/entity')
  @CacheControl({ visibility: 'private', maxAgeSecs: 120 })
  entity() {
    return { id: '1', value: 'ok' };
  }

  @Get('cache/default')
  defaultCaching() {
    return { ok: true };
  }
}

@Module({
  imports: [CacheModule, HttpModule],
  controllers: [CacheController],
})
class TestCacheAppModule {}

describeHttpIf('etag + cache-control e2e', () => {
  async function createApp(): Promise<INestApplication> {
    const moduleRef = await Test.createTestingModule({ imports: [TestCacheAppModule] }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    return app;
  }

  it('supports conditional GET and emits explicit cache-control', async () => {
    const app = await createApp();

    try {
      const first = await request(app.getHttpServer()).get('/cache/entity').expect(200);
      expect(first.headers['etag']).toMatch(/^"[A-Za-z0-9_-]{27}"$/);
      expect(first.headers['cache-control']).toBe('private, max-age=120');

      const etag = String(first.headers['etag']);
      const notModified = await request(app.getHttpServer())
        .get('/cache/entity')
        .set('If-None-Match', etag)
        .expect(304);

      expect(notModified.text).toBe('');
      expect(notModified.headers['etag']).toBe(etag);
      expect(notModified.headers['cache-control']).toBe('private, max-age=120');

      const mismatch = await request(app.getHttpServer())
        .get('/cache/entity')
        .set('If-None-Match', '"different"')
        .expect(200);

      expect(mismatch.body).toEqual({ id: '1', value: 'ok' });

      const noDecorator = await request(app.getHttpServer()).get('/cache/default').expect(200);
      expect(noDecorator.headers['cache-control']).toBe('no-cache');
    } finally {
      await app.close();
    }
  });
});
