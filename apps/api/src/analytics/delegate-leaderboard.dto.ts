import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AnalyticsMetaDto } from './analytics-meta.dto';

export class DelegateLeaderboardQueryDto {
  @ApiPropertyOptional({ description: 'Max delegates to return (1–100, default 25).' })
  declare limit?: string;
}

export class DelegateLeaderboardRowDto {
  @ApiProperty({ description: '1-based rank by current received voting power.' })
  declare rank: number;

  @ApiProperty()
  declare actor_id: string;

  @ApiProperty()
  declare address: string;

  @ApiPropertyOptional({ nullable: true })
  declare display_name: string | null;

  @ApiProperty({ description: 'Current received voting power, base units (UInt256 as string).' })
  declare voting_power: string;

  @ApiProperty({ description: 'Share of the DAO-wide delegated voting power, 0..1.' })
  declare voting_power_share: number;

  @ApiProperty({ description: 'Number of addresses currently delegating to this delegate.' })
  declare delegator_count: number;
}

export class DelegateLeaderboardResponseDto {
  @ApiProperty({ type: () => [DelegateLeaderboardRowDto] })
  declare data: DelegateLeaderboardRowDto[];

  @ApiProperty({ type: AnalyticsMetaDto })
  declare _meta: AnalyticsMetaDto;
}
