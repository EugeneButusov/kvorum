import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppService } from './app.service';

@ApiTags('Service')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @ApiOperation({
    summary: 'Get service metadata',
    description: 'Service banner for the API root. Unauthenticated.',
  })
  @Get()
  getData() {
    return this.appService.getData();
  }
}
