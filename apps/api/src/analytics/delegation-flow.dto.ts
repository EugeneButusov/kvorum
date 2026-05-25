import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AnalyticsMetaDto } from './analytics-meta.dto';

export class DelegationFlowQueryDto {
  @ApiPropertyOptional()
  declare from?: string;

  @ApiPropertyOptional()
  declare to?: string;

  @ApiPropertyOptional()
  declare min_voting_power?: string;
}

export class DelegationFlowNodeDto {
  @ApiProperty()
  declare actor_id: string;

  @ApiProperty()
  declare primary_address: string;

  @ApiPropertyOptional({ nullable: true })
  declare display_name: string | null;

  @ApiProperty()
  declare current_voting_power: string;
}

export class DelegationFlowEdgeDto {
  @ApiProperty()
  declare delegator_actor_id: string;

  @ApiPropertyOptional({ nullable: true })
  declare delegate_actor_id: string | null;

  @ApiProperty()
  declare voting_power: string;

  @ApiProperty()
  declare block_number: string;

  @ApiProperty()
  declare event_type: string;

  @ApiProperty()
  declare created_at: string;
}

export class DelegationFlowResponseDto {
  @ApiProperty({ type: () => [DelegationFlowNodeDto] })
  declare nodes: DelegationFlowNodeDto[];

  @ApiProperty({ type: () => [DelegationFlowEdgeDto] })
  declare edges: DelegationFlowEdgeDto[];

  @ApiProperty({ type: AnalyticsMetaDto })
  declare _meta: AnalyticsMetaDto;
}
