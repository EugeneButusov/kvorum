import { Controller, Get, Logger, Module } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { LoggingModule, usePinoNestLogger } from '@nest/logging';
import { HttpModule } from '../src/http/http.module';

const describeHttpIf = process.env.NEST_HTTP_TESTS === '1' ? describe : describe.skip;

@Controller()
class TestLoggingController {
  private readonly logger = new Logger(TestLoggingController.name);

  @Get('logging-check')
  check() {
    this.logger.log('controller log line');
    return { ok: true };
  }
}

@Module({
  imports: [HttpModule, LoggingModule],
  controllers: [TestLoggingController],
})
class TestLoggingAppModule {}

describeHttpIf('structured request logging e2e', () => {
  async function createApp(): Promise<INestApplication> {
    const moduleRef = await Test.createTestingModule({
      imports: [TestLoggingAppModule],
    }).compile();

    const app = moduleRef.createNestApplication({ bufferLogs: true });
    usePinoNestLogger(app);
    await app.init();
    return app;
  }

  it('emits required fields and echoes/regenerates request id', async () => {
    const lines: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(((
      chunk: string | Uint8Array,
    ) => {
      lines.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    }) as typeof process.stdout.write);

    const app = await createApp();

    try {
      const ok = await request(app.getHttpServer())
        .get('/logging-check')
        .set('X-Request-Id', 'req-valid-123')
        .expect(200);

      expect(ok.headers['x-request-id']).toBe('req-valid-123');

      const regenerated = await request(app.getHttpServer())
        .get('/logging-check')
        .set('X-Request-Id', 'bad val!!')
        .expect(200);

      expect(regenerated.headers['x-request-id']).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );

      const records = lines
        .join('')
        .split('\n')
        .filter((line) => line.trim().startsWith('{'))
        .map((line) => JSON.parse(line) as Record<string, unknown>);

      const controllerRecord = records.find((r) => r['message'] === 'controller log line');
      expect(controllerRecord).toBeDefined();
      expect(controllerRecord).toEqual(
        expect.objectContaining({
          timestamp: expect.any(String),
          level: expect.any(String),
          service: 'api-test',
          request_id: expect.any(String),
          message: 'controller log line',
        }),
      );
    } finally {
      writeSpy.mockRestore();
      process.stdout.write = originalWrite;
      await app.close();
    }
  });
});
