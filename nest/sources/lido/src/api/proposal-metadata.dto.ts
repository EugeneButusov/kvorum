import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// Per-source proposal metadata DTOs for the three Lido on-chain tracks, discriminated by `kind`
// (== source_type). Contributed to the proposal-detail `metadata` union assembled by apps/api.
export class AragonProposalMetadataDto {
  @ApiProperty({ enum: ['aragon_voting'] })
  declare kind: 'aragon_voting';

  @ApiProperty()
  declare app_address: string;

  @ApiPropertyOptional({ nullable: true })
  declare app_version: string | null;

  @ApiPropertyOptional({ nullable: true })
  declare support_required_pct: string | null;

  @ApiPropertyOptional({ nullable: true })
  declare min_accept_quorum_pct: string | null;

  @ApiPropertyOptional({ nullable: true })
  declare main_phase_ends_at: string | null;

  @ApiPropertyOptional({ nullable: true })
  declare objection_phase_ends_at: string | null;

  @ApiPropertyOptional({ nullable: true })
  declare executed_at: string | null;
}

export class DualGovernanceProposalMetadataDto {
  @ApiProperty({ enum: ['dual_governance'] })
  declare kind: 'dual_governance';

  @ApiProperty({ enum: ['aragon', 'direct'] })
  declare origin: 'aragon' | 'direct';

  @ApiProperty()
  declare dg_proposal_id: string;

  @ApiProperty({ enum: ['submitted', 'scheduled', 'executed', 'cancelled'] })
  declare status: 'submitted' | 'scheduled' | 'executed' | 'cancelled';

  @ApiProperty()
  declare executor: string;

  @ApiPropertyOptional({ nullable: true })
  declare aragon_source_id: string | null;

  @ApiProperty()
  declare submitted_at: string;

  @ApiPropertyOptional({ nullable: true })
  declare scheduled_at: string | null;

  @ApiPropertyOptional({ nullable: true })
  declare executed_at: string | null;

  @ApiPropertyOptional({ nullable: true })
  declare cancelled_at: string | null;
}

export class EasyTrackProposalMetadataDto {
  @ApiProperty({ enum: ['easy_track'] })
  declare kind: 'easy_track';

  @ApiProperty()
  declare motion_id: string;

  @ApiProperty()
  declare factory_address: string;

  @ApiProperty()
  declare objection_ends_at: string;

  @ApiProperty({ enum: ['active', 'enacted', 'objected', 'rejected', 'canceled'] })
  declare state: 'active' | 'enacted' | 'objected' | 'rejected' | 'canceled';
}
