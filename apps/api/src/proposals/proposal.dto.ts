import { ApiExtraModels, ApiProperty, ApiPropertyOptional, refs } from '@nestjs/swagger';
import type { ProposalSourceMetadata } from '@libs/domain';
import {
  OffchainDiscussionLinkDto,
  PROPOSAL_METADATA_DTOS,
  ProposalPayloadGroupDto,
  ProposalVotingDto,
} from '@nest/sources';
import { PaginationDto } from '../openapi/openapi.dto';

export class ProposalLinksDto {
  @ApiProperty()
  declare self: string;

  @ApiProperty()
  declare votes: string;
}

export class ProposalMetaDto {
  @ApiProperty()
  declare confirmed: boolean;

  @ApiProperty()
  declare last_updated_at: string;

  @ApiProperty({ type: ProposalLinksDto })
  declare links: ProposalLinksDto;
}

export class ProposerDto {
  @ApiProperty()
  declare address: string;

  @ApiPropertyOptional({ nullable: true })
  declare display_name: string | null;
}

export class ProposalActionDto {
  @ApiProperty()
  declare action_index: number;

  @ApiProperty()
  declare target_address: string;

  @ApiProperty()
  declare target_chain_id: string;

  @ApiProperty({ type: String })
  declare value_wei: string;

  @ApiPropertyOptional({ nullable: true })
  declare function_signature: string | null;

  @ApiProperty()
  declare calldata: string;

  @ApiPropertyOptional({ nullable: true })
  declare decoded_function: string | null;

  @ApiPropertyOptional({ nullable: true })
  declare decoded_arguments: unknown | null;
}

export class ProposalChoiceDto {
  @ApiProperty()
  declare choice_index: number;

  @ApiProperty()
  declare value: string;
}

export class ProposalTallySummaryChoiceDto {
  @ApiProperty()
  declare choice_index: number;

  @ApiProperty({
    description: 'The declared choice label, e.g. "for" — for client-side classification.',
  })
  declare label: string;

  @ApiProperty({ description: 'Share of participating power, 0–100, to two decimals.' })
  declare pct: number;
}

export class ProposalTallySummaryDto {
  @ApiProperty({ type: [ProposalTallySummaryChoiceDto] })
  declare choices: ProposalTallySummaryChoiceDto[];
}

export class ProposalListItemDto {
  @ApiProperty()
  declare dao_slug: string;

  @ApiProperty()
  declare source_type: string;

  @ApiProperty()
  declare source_id: string;

  @ApiProperty({ nullable: true })
  declare title: string | null;

  @ApiProperty()
  declare state: string;

  @ApiProperty()
  declare binding: boolean;

  @ApiProperty({ nullable: true })
  declare voting_starts_at: string | null;

  @ApiProperty({ nullable: true })
  declare voting_ends_at: string | null;

  @ApiProperty({ type: ProposerDto })
  declare proposer: ProposerDto;

  @ApiPropertyOptional({
    type: ProposalTallySummaryDto,
    nullable: true,
    description: 'Per-choice voting-power tally for the row bars; null when no votes are cast yet.',
  })
  declare tally: ProposalTallySummaryDto | null;

  @ApiProperty({ type: ProposalMetaDto })
  declare _meta: ProposalMetaDto;
}

export class ProposalAiSummaryMetaDto {
  @ApiProperty({ example: true, description: 'Always true — labels AI-generated content.' })
  declare ai_generated: boolean;

  @ApiProperty()
  declare model: string;

  @ApiProperty()
  declare prompt_version: string;

  @ApiProperty({ description: 'sha256: of the summarized input (description + decoded actions).' })
  declare input_hash: string;

  @ApiProperty()
  declare generated_at: string;
}

export class ProposalAiSummaryKeyChangeDto {
  @ApiProperty()
  declare description: string;

  @ApiProperty({ description: 'high | medium | low' })
  declare significance: string;
}

// SPEC §5.4/§5.5 — the stored ProposalSummary plus a provenance `_meta` block.
export class ProposalAiSummaryDto {
  @ApiProperty()
  declare tldr: string;

  @ApiProperty()
  declare proposal_type: string;

  @ApiProperty({ description: 'high | medium | low' })
  declare proposal_type_confidence: string;

  @ApiProperty({ type: [String] })
  declare affected_contracts: string[];

  @ApiProperty({ type: [ProposalAiSummaryKeyChangeDto] })
  declare key_changes: ProposalAiSummaryKeyChangeDto[];

  @ApiPropertyOptional({ type: [String] })
  declare beneficiaries?: string[];

  @ApiProperty({ nullable: true, type: String })
  declare funding_amount_usd: string | null;

  @ApiPropertyOptional({ type: [String] })
  declare notable_concerns?: string[];

  @ApiProperty({ type: ProposalAiSummaryMetaDto })
  declare _meta: ProposalAiSummaryMetaDto;
}

export class ProposalAiSummaryResponseDto {
  @ApiProperty({ type: ProposalAiSummaryDto })
  declare data: ProposalAiSummaryDto;
}

@ApiExtraModels(...PROPOSAL_METADATA_DTOS)
export class ProposalDetailDto extends ProposalListItemDto {
  @ApiProperty()
  declare description: string;

  @ApiProperty({ type: () => [ProposalActionDto] })
  declare actions: ProposalActionDto[];

  @ApiProperty({ type: () => [ProposalChoiceDto] })
  declare choices: ProposalChoiceDto[];

  @ApiProperty()
  declare origin_chain_id: string;

  @ApiPropertyOptional({ nullable: true, type: ProposalVotingDto })
  declare voting?: ProposalVotingDto | null;

  @ApiPropertyOptional({ nullable: true, type: [ProposalPayloadGroupDto] })
  declare payloads?: ProposalPayloadGroupDto[] | null;

  // Source-specific metadata, discriminated by `kind` (== source_type). Null when the source
  // carries none (e.g. Compound/Aave, which use `voting`/`payloads` instead). The union members are
  // contributed by each source's nest package (aggregated as PROPOSAL_METADATA_DTOS).
  @ApiPropertyOptional({ nullable: true, oneOf: refs(...PROPOSAL_METADATA_DTOS) })
  declare metadata?: ProposalSourceMetadata | null;

  @ApiProperty({ type: () => [OffchainDiscussionLinkDto] })
  declare offchain_discussion_links: OffchainDiscussionLinkDto[];

  @ApiPropertyOptional({
    type: ProposalAiSummaryDto,
    nullable: true,
    description: 'AI-generated summary + provenance _meta; null when not yet produced or capped.',
  })
  declare ai_summary: ProposalAiSummaryDto | null;
}

export class ProposalDetailResponseDto {
  @ApiProperty({ type: ProposalDetailDto })
  declare data: ProposalDetailDto;
}

export class ProposalListResponseDto {
  @ApiProperty({ type: () => [ProposalListItemDto] })
  declare data: ProposalListItemDto[];

  @ApiProperty({ type: PaginationDto })
  declare pagination: PaginationDto;
}
