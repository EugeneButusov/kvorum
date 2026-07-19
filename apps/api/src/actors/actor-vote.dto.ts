import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../openapi/openapi.dto';

export class EmbeddedProposalLinksDto {
  @ApiProperty()
  declare proposal: string;
}

export class EmbeddedProposalMetaDto {
  @ApiProperty({ type: EmbeddedProposalLinksDto })
  declare links: EmbeddedProposalLinksDto;
}

export class EmbeddedProposalDto {
  @ApiProperty()
  declare proposal_id: string;

  @ApiProperty()
  declare source_type: string;

  @ApiProperty()
  declare dao_slug: string;

  @ApiPropertyOptional({ nullable: true })
  declare title: string | null;

  @ApiProperty()
  declare state: string;

  @ApiProperty()
  declare created_at: string;

  @ApiPropertyOptional({ nullable: true })
  declare voting_ends_at: string | null;

  @ApiProperty({ type: EmbeddedProposalMetaDto })
  declare _meta: EmbeddedProposalMetaDto;
}

export class ActorVoteMetaDto {
  @ApiProperty()
  declare confirmed: boolean;
}

export class ActorVoteListItemDto {
  @ApiProperty()
  declare vote_id: string;

  @ApiProperty()
  declare voting_chain_id: string;

  @ApiProperty({ type: EmbeddedProposalDto })
  declare proposal: EmbeddedProposalDto;

  @ApiPropertyOptional({ nullable: true })
  declare primary_choice: number | null;

  // `type` is explicit because the `declare` fields on this DTO emit no design-time metadata —
  // without it the generated client types this as an empty object (as primary_choice/cast_at are).
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description:
      'The proposal’s declared label for primary_choice, e.g. "for". Null when the proposal ' +
      'declares no choice at that index, so the client can fall back rather than invent one.',
  })
  declare choice_label: string | null;

  @ApiProperty({ type: String })
  declare voting_power_reported: string;

  @ApiProperty({ nullable: true })
  declare cast_at: string | null;

  @ApiProperty({ type: ActorVoteMetaDto })
  declare _meta: ActorVoteMetaDto;
}

export class ActorVoteListResponseDto {
  @ApiProperty({ type: () => [ActorVoteListItemDto] })
  declare data: ActorVoteListItemDto[];

  @ApiProperty({ type: PaginationDto })
  declare pagination: PaginationDto;
}
