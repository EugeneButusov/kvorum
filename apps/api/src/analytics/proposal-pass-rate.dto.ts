import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AnalyticsMetaDto } from './analytics-meta.dto';

export class PassRateQueryDto {
  @ApiPropertyOptional({ enum: ['daily', 'weekly', 'monthly'] })
  declare bucket?: 'daily' | 'weekly' | 'monthly';

  @ApiPropertyOptional()
  declare from?: string;

  @ApiPropertyOptional()
  declare to?: string;

  @ApiPropertyOptional()
  declare proposal_type?: string;
}

export class PassRateRowDto {
  @ApiProperty()
  declare source_type: string;

  @ApiProperty()
  declare bucket: string;

  @ApiProperty()
  declare passed: number;

  @ApiProperty()
  declare failed: number;

  @ApiPropertyOptional({ nullable: true })
  declare pass_rate: number | null;
}

export class PassRateResponseDto {
  @ApiProperty({ type: () => [PassRateRowDto] })
  declare data: PassRateRowDto[];

  @ApiProperty({ type: AnalyticsMetaDto })
  declare _meta: AnalyticsMetaDto;
}
