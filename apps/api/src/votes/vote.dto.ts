import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../openapi/openapi.dto';

export class ActorLinkDto {
  @ApiProperty()
  declare actor: string;
}

export class EmbeddedActorMetaDto {
  @ApiProperty({ type: ActorLinkDto })
  declare links: ActorLinkDto;
}

export class VoterDto {
  @ApiProperty()
  declare address: string;

  @ApiPropertyOptional({ nullable: true })
  declare display_name: string | null;

  @ApiProperty({ type: EmbeddedActorMetaDto })
  declare _meta: EmbeddedActorMetaDto;
}

export class VoteMetaDto {
  @ApiProperty()
  declare confirmed: boolean;
}

export class VoteChoiceDto {
  @ApiProperty()
  declare choice_index: number;

  @ApiProperty({ type: String })
  declare weight: string;
}

export class VoteListItemDto {
  @ApiProperty()
  declare vote_id: string;

  @ApiProperty()
  declare voting_chain_id: string;

  @ApiProperty({ type: VoterDto })
  declare voter: VoterDto;

  @ApiProperty({ type: String })
  declare voting_power_reported: string;

  @ApiProperty()
  declare voting_power_verified: boolean;

  @ApiProperty({ nullable: true })
  declare primary_choice: number | null;

  @ApiProperty({ nullable: true })
  declare cast_at: string | null;

  @ApiPropertyOptional({ nullable: true })
  declare reason: string | null;

  @ApiProperty({ type: VoteMetaDto })
  declare _meta: VoteMetaDto;
}

export class VoteDetailDto extends VoteListItemDto {
  @ApiProperty({ type: () => [VoteChoiceDto] })
  declare choices: VoteChoiceDto[];
}

export class VoteListResponseDto {
  @ApiProperty({ type: () => [VoteListItemDto] })
  declare data: VoteListItemDto[];

  @ApiProperty({ type: PaginationDto })
  declare pagination: PaginationDto;
}

export class VoteDetailResponseDto {
  @ApiProperty({ nullable: true, type: VoteDetailDto })
  declare data: VoteDetailDto | null;
}
