import { Controller, Get, Module } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { OpsServer } from '../../../nest/observability/src/ops-server';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { HttpModule } from '../src/http/http.module';
import { ObservabilityModule } from '../src/observability/observability.module';

const describeHttpIf = process.env.NEST_HTTP_TESTS === '1' ? describe : describe.skip;

@Controller()
class MetricsController {
  @Get('metrics-demo')
  ok() {
    return { ok: true };
  }
}

@Module({
  imports: [HttpModule, ObservabilityModule],
  controllers: [MetricsController],
  providers: [OpsServer],
})
class TestMetricsAppModule {}

async function scrapeMetrics(port: number): Promise<string> {
  const response = await fetch(`http://127.0.0.1:${port}/metrics`);
  if (!response.ok) {
    throw new Error(`metrics scrape failed with status ${response.status}`);
  }
  return response.text();
}

describeHttpIf('api metrics e2e', () => {
  it('emits service-prefixed api request metrics after a request', async () => {
    const previousOpsPort = process.env['OPS_PORT'];
    process.env['OPS_PORT'] = '19091';

    const moduleRef = await Test.createTestingModule({ imports: [TestMetricsAppModule] }).compile();
    const app: INestApplication = moduleRef.createNestApplication();

    try {
      await app.init();
      await request(app.getHttpServer()).get('/metrics-demo').expect(200);

      const metrics = await scrapeMetrics(19091);
      expect(metrics).toContain('api_test_api_requests_total');
      expect(metrics).toContain('api_test_api_latency_seconds_bucket');
      expect(metrics).toContain('method="GET"');
      expect(metrics).toContain('route="/metrics-demo"');
      expect(metrics).toContain('status="200"');
    } finally {
      await app.close();
      if (previousOpsPort === undefined) {
        delete process.env['OPS_PORT'];
      } else {
        process.env['OPS_PORT'] = previousOpsPort;
      }
    }
  });
});
