import { Controller, Get } from '@nestjs/common';
import { Public } from '@nest/auth';

@Controller()
export class HealthController {
  @Public()
  @Get('health')
  @Public()
  health() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
