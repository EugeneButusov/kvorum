import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@nest/auth';

@ApiTags('Service')
@Controller()
export class HealthController {
  @ApiOperation({
    summary: 'Check service health',
    description:
      'Liveness probe. Returns 200 while the process is serving; it does not check downstream dependencies. Unauthenticated.',
  })
  @Public()
  @Get('health')
  @Public()
  health() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
