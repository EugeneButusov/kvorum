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

// Shared mismatch provenance `_meta` — used by both the embedded `ai_mismatch_flag` and the dedicated
// `/ai/mismatch` full-analysis response (mirrors the single ProposalAiSummaryMetaDto).
export class ProposalAiMismatchMetaDto {
  @ApiProperty({ example: true, description: 'Always true — labels AI-generated content.' })
  declare ai_generated: boolean;

  @ApiProperty()
  declare model: string;

  @ApiProperty()
  declare prompt_version: string;

  @ApiProperty({ description: 'sha256: of the analyzed input (description + decoded actions).' })
  declare input_hash: string;

  @ApiProperty()
  declare generated_at: string;
}

// SPEC §5.4/§5.6, ADR-080 — the conservative surfacing of a stored MismatchAnalysis: present ONLY for a
// material/severe, non-low-confidence discrepancy. The full structured analysis (incl. consistent, minor,
// and low-confidence cases) is available via the dedicated /ai/mismatch endpoint (#449).
export class ProposalAiMismatchFlagDto {
  @ApiProperty({ description: 'material_discrepancy | severe_discrepancy' })
  declare assessment: string;

  @ApiProperty({ description: "The highest-severity discrepancy's description." })
  declare summary: string;

  @ApiProperty({ type: ProposalAiMismatchMetaDto })
  declare _meta: ProposalAiMismatchMetaDto;
}

export class MismatchDescriptionActionDto {
  @ApiProperty({ description: "A claim the proposal's prose makes about what it does." })
  declare claim: string;

  @ApiProperty({ description: 'Brief reference to where in the description the claim appears.' })
  declare location: string;
}

export class MismatchCalldataActionDto {
  @ApiProperty()
  declare action_index: number;

  @ApiProperty({ description: 'Plain-language summary of what the decoded calldata action does.' })
  declare summary: string;

  @ApiProperty({ description: 'high | medium | low' })
  declare significance: string;
}

export class MismatchDiscrepancyDto {
  @ApiProperty({
    description:
      'value_mismatch | omitted_in_description | extra_in_description | misleading_phrasing | target_mismatch',
  })
  declare type: string;

  @ApiProperty()
  declare description: string;

  @ApiProperty({ description: 'high | medium | low' })
  declare severity: string;

  @ApiProperty({ nullable: true, type: String })
  declare description_excerpt: string | null;

  @ApiProperty({ type: [Number] })
  declare related_action_indices: number[];
}

// SPEC §5.4/§5.6 — the FULL stored MismatchAnalysis + provenance `_meta`, returned by the dedicated
// /ai/mismatch endpoint. Unlike the embedded `ai_mismatch_flag`, this bypasses the surfacing threshold:
// every stored analysis (incl. consistent / minor / low-confidence) is retrievable here.
export class ProposalMismatchDto {
  @ApiProperty({
    description: 'consistent | minor_discrepancy | material_discrepancy | severe_discrepancy',
  })
  declare overall_assessment: string;

  @ApiProperty({ description: 'high | medium | low' })
  declare confidence: string;

  @ApiProperty({ type: [MismatchDescriptionActionDto] })
  declare description_actions: MismatchDescriptionActionDto[];

  @ApiProperty({ type: [MismatchCalldataActionDto] })
  declare calldata_actions: MismatchCalldataActionDto[];

  @ApiProperty({ type: [MismatchDiscrepancyDto] })
  declare discrepancies: MismatchDiscrepancyDto[];

  @ApiProperty({ description: "The model's explanation of its assessment (shown to users)." })
  declare reasoning: string;

  @ApiProperty({ type: ProposalAiMismatchMetaDto })
  declare _meta: ProposalAiMismatchMetaDto;
}

export class ProposalMismatchResponseDto {
  @ApiProperty({ type: ProposalMismatchDto })
  declare data: ProposalMismatchDto;
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

  @ApiPropertyOptional({
    type: ProposalAiMismatchFlagDto,
    nullable: true,
    description:
      'Conservative calldata-vs-prose mismatch flag + provenance _meta. Null when no analysis exists ' +
      '(non-binding, undecoded, unprocessed, or capped) or when the analysis found no material/severe, ' +
      'confident discrepancy. The full analysis is at the dedicated /ai/mismatch endpoint.',
  })
  declare ai_mismatch_flag: ProposalAiMismatchFlagDto | null;
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
