import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AnalyticsMetaDto } from './analytics-meta.dto';

export class ConcentrationQueryDto {
  @ApiPropertyOptional({ enum: ['daily', 'weekly', 'monthly'] })
  declare bucket?: 'daily' | 'weekly' | 'monthly';

  @ApiPropertyOptional()
  declare from?: string;

  @ApiPropertyOptional()
  declare to?: string;
}

export class ConcentrationTopShareDto {
  @ApiProperty()
  declare n_1: number;
  @ApiProperty()
  declare n_5: number;
  @ApiProperty()
  declare n_10: number;
  @ApiProperty()
  declare n_20: number;
}

export class ConcentrationRowDto {
  @ApiProperty()
  declare bucket: string;

  @ApiProperty()
  declare gini: number;

  @ApiProperty({ type: ConcentrationTopShareDto })
  declare top_share: ConcentrationTopShareDto;

  @ApiProperty()
  declare effective_delegate_count: number;

  @ApiProperty()
  declare total_voting_power: string;

  @ApiProperty()
  declare delegate_count: number;
}

export class ConcentrationResponseDto {
  @ApiProperty({ type: () => [ConcentrationRowDto] })
  declare data: ConcentrationRowDto[];

  @ApiProperty({ type: AnalyticsMetaDto })
  declare _meta: AnalyticsMetaDto;
}
