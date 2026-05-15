import { Controller, Get, Module, NotFoundException, Res } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { z } from 'zod';
import { HttpModule } from '../src/http/http.module';

const describeHttpIf = process.env.NEST_HTTP_TESTS === '1' ? describe : describe.skip;

@Controller()
class ProblemController {
  @Get('throws/zod')
  throwsZod() {
    z.object({ id: z.number() }).parse({ id: 'x' });
  }

  @Get('throws/not-found')
  throwsNotFound() {
    throw new NotFoundException('nope');
  }

  @Get('throws/raw')
  throwsRaw() {
    throw new Error('boom');
  }

  @Get('throws/with-header')
  throwsWithHeader(
    @Res({ passthrough: true }) response: { setHeader: (name: string, value: string) => void },
  ) {
    response.setHeader('x-custom', 'keep-me');
    throw new NotFoundException('nope');
  }
}

@Module({
  imports: [HttpModule],
  controllers: [ProblemController],
})
class ProblemTestModule {}

describeHttpIf('problem details filter e2e', () => {
  async function createApp(): Promise<INestApplication> {
    const moduleRef = await Test.createTestingModule({ imports: [ProblemTestModule] }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    return app;
  }

  it('returns problem+json for zod error', async () => {
    const app = await createApp();

    try {
      const response = await request(app.getHttpServer()).get('/throws/zod');
      expect(response.status).toBe(400);
      expect(response.headers['content-type']).toContain('application/problem+json');
      expect(response.body.type).toBe('urn:error:validation');
      expect(Array.isArray(response.body.violations)).toBe(true);
    } finally {
      await app.close();
    }
  });

  it('returns problem+json for not found and preserves pre-set headers', async () => {
    const app = await createApp();

    try {
      const response = await request(app.getHttpServer()).get('/throws/with-header');
      expect(response.status).toBe(404);
      expect(response.headers['x-custom']).toBe('keep-me');
      expect(response.headers['content-type']).toContain('application/problem+json');
      expect(response.body.type).toBe('urn:error:not-found');
    } finally {
      await app.close();
    }
  });

  it('returns generic internal error problem', async () => {
    const app = await createApp();

    try {
      const response = await request(app.getHttpServer()).get('/throws/raw');
      expect(response.status).toBe(500);
      expect(response.headers['content-type']).toContain('application/problem+json');
      expect(response.body.type).toBe('urn:error:internal-error');
      expect(response.body.detail).toBe('An unexpected error occurred.');
    } finally {
      await app.close();
    }
  });
});
