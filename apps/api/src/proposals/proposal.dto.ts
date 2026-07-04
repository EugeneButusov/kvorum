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

  @ApiProperty({ type: ProposalMetaDto })
  declare _meta: ProposalMetaDto;
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
