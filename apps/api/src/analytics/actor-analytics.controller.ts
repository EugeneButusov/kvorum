import { Controller } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

@ApiTags('analytics')
@ApiBearerAuth()
@Controller('v1/actors/:address/analytics')
export class ActorAnalyticsController {}
