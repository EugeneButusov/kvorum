import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AnalyticsMetaDto } from './analytics-meta.dto';

export class ParticipationQueryDto {
  @ApiPropertyOptional({ enum: ['daily', 'weekly', 'monthly'] })
  declare bucket?: 'daily' | 'weekly' | 'monthly';

  @ApiPropertyOptional()
  declare from?: string;

  @ApiPropertyOptional()
  declare to?: string;

  @ApiPropertyOptional()
  declare proposal_type?: string;
}

export class ParticipationRowDto {
  @ApiProperty()
  declare source_type: string;

  @ApiProperty()
  declare bucket: string;

  @ApiPropertyOptional({ nullable: true })
  declare participation_rate: number | null;

  @ApiProperty()
  declare proposal_count: number;

  @ApiProperty()
  declare proposals_with_data: number;
}

export class ParticipationResponseDto {
  @ApiProperty({ type: () => [ParticipationRowDto] })
  declare data: ParticipationRowDto[];

  @ApiProperty({ type: AnalyticsMetaDto })
  declare _meta: AnalyticsMetaDto;
}
