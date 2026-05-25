import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../openapi/openapi.dto';

export class ActorProposalMetaDto {
  @ApiProperty()
  declare confirmed: boolean;
}

export class ActorProposalListItemDto {
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

  @ApiProperty({ nullable: true })
  declare voting_starts_at: string | null;

  @ApiProperty({ nullable: true })
  declare voting_ends_at: string | null;

  @ApiProperty()
  declare created_at: string;

  @ApiProperty({ type: ActorProposalMetaDto })
  declare _meta: ActorProposalMetaDto;
}

export class ActorProposalListResponseDto {
  @ApiProperty({ type: () => [ActorProposalListItemDto] })
  declare data: ActorProposalListItemDto[];

  @ApiProperty({ type: PaginationDto })
  declare pagination: PaginationDto;
}
