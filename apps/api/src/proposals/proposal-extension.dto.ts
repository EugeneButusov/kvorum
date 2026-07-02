import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ProposalVotingDto {
  @ApiPropertyOptional({ nullable: true })
  declare voting_chain_id: string | null;

  @ApiPropertyOptional({ nullable: true })
  declare voting_machine_address: string | null;

  @ApiPropertyOptional({ nullable: true })
  declare voting_strategy_address: string | null;

  @ApiProperty()
  declare creation_block: string;
}

export class ProposalPayloadDto {
  @ApiProperty()
  declare payload_index: number;

  @ApiProperty()
  declare payload_id: string;

  @ApiProperty()
  declare payloads_controller_address: string;

  @ApiProperty()
  declare status: string;

  @ApiPropertyOptional({ nullable: true })
  declare executed_at_destination: string | null;

  @ApiProperty()
  declare unindexed_target_chain: boolean;
}

export class ProposalPayloadGroupDto {
  @ApiProperty()
  declare target_chain_id: string;

  @ApiProperty({ type: [ProposalPayloadDto] })
  declare payloads: ProposalPayloadDto[];
}

// ── Per-source proposal metadata (discriminated by `kind` == source_type) ────────

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

export class SnapshotProposalMetadataDto {
  @ApiProperty({ enum: ['snapshot'] })
  declare kind: 'snapshot';

  @ApiProperty()
  declare space_id: string;

  @ApiPropertyOptional({ nullable: true })
  declare voting_type: string | null;

  @ApiPropertyOptional({ nullable: true, type: Object })
  declare strategies: unknown | null;

  @ApiPropertyOptional({ nullable: true })
  declare ipfs_hash: string | null;

  @ApiPropertyOptional({ nullable: true })
  declare network: string | null;

  @ApiPropertyOptional({ nullable: true })
  declare scores_state: string | null;

  @ApiProperty()
  declare flagged: boolean;
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

// ── Forum links (cross-source; sourced from proposal_forum_link ⨝ forum_thread) ──

export class ProposalForumLinkDto {
  @ApiProperty()
  declare forum_host: string;

  @ApiProperty()
  declare forum_topic_id: string;

  @ApiPropertyOptional({ nullable: true })
  declare title: string | null;

  @ApiProperty()
  declare url: string;

  @ApiProperty({ enum: ['high', 'medium', 'low'] })
  declare confidence: 'high' | 'medium' | 'low';

  @ApiPropertyOptional({ nullable: true })
  declare last_activity_at: string | null;
}
