import { Controller, Get, Header } from '@nestjs/common';
import { renderMetrics } from '@libs/observability';

@Controller()
export class MetricsController {
  @Get('metrics')
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async metrics() {
    return renderMetrics();
  }
}
