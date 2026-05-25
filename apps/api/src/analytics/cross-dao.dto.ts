import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AnalyticsMetaDto } from './analytics-meta.dto';

export class CrossDaoSummaryDto {
  @ApiProperty()
  declare dao_slug: string;

  @ApiProperty()
  declare votes_cast: number;

  @ApiProperty()
  declare proposals_proposed: number;

  @ApiProperty()
  declare current_voting_power: string;

  @ApiPropertyOptional({ nullable: true })
  declare last_active_at: string | null;

  @ApiPropertyOptional({ nullable: true })
  declare alignment_with_majority_pct: number | null;
}

export class CrossDaoActorDto {
  @ApiProperty()
  declare address: string;

  @ApiProperty()
  declare actor_id: string;

  @ApiProperty({ type: () => [CrossDaoSummaryDto] })
  declare daos: CrossDaoSummaryDto[];

  @ApiProperty({ type: AnalyticsMetaDto })
  declare _meta: AnalyticsMetaDto;
}
