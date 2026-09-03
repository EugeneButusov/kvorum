import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AnalyticsMetaDto } from './analytics-meta.dto';

export class ForumActivityQueryDto {
  @ApiPropertyOptional({ enum: ['daily', 'weekly', 'monthly'] })
  declare bucket?: 'daily' | 'weekly' | 'monthly';

  @ApiPropertyOptional()
  declare from?: string;

  @ApiPropertyOptional()
  declare to?: string;
}

export class ForumActivityRowDto {
  @ApiProperty()
  declare bucket: string;

  @ApiProperty()
  declare post_count: number;
}

export class ForumActivityResponseDto {
  @ApiProperty({ type: () => [ForumActivityRowDto] })
  declare data: ForumActivityRowDto[];

  @ApiProperty({ type: AnalyticsMetaDto })
  declare _meta: AnalyticsMetaDto;
}
