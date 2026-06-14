import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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

export class ProposalDetailDto extends ProposalListItemDto {
  @ApiProperty()
  declare description: string;

  @ApiProperty({ type: () => [ProposalActionDto] })
  declare actions: ProposalActionDto[];

  @ApiProperty({ type: () => [ProposalChoiceDto] })
  declare choices: ProposalChoiceDto[];
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
