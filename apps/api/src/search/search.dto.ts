import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ProposalSearchItemDto {
  @ApiProperty()
  declare dao_slug: string;

  @ApiProperty()
  declare dao_name: string;

  @ApiProperty()
  declare source_type: string;

  @ApiProperty()
  declare source_id: string;

  @ApiPropertyOptional({ nullable: true })
  declare title: string | null;

  @ApiProperty()
  declare state: string;

  @ApiPropertyOptional({ nullable: true })
  declare voting_starts_at: string | null;

  @ApiProperty()
  declare rank: number;
}

export class DaoSearchItemDto {
  @ApiProperty()
  declare slug: string;

  @ApiProperty()
  declare name: string;

  @ApiProperty()
  declare description: string;

  @ApiProperty()
  declare rank: number;
}

export class ActorSearchItemDto {
  @ApiPropertyOptional({ nullable: true })
  declare display_name: string | null;

  @ApiProperty()
  declare primary_address: string;

  @ApiProperty()
  declare rank: number;
}

export class SearchDataDto {
  @ApiProperty({ type: [ProposalSearchItemDto] })
  declare proposals: ProposalSearchItemDto[];

  @ApiProperty({ type: [DaoSearchItemDto] })
  declare daos: DaoSearchItemDto[];

  @ApiProperty({ type: [ActorSearchItemDto] })
  declare actors: ActorSearchItemDto[];
}

export class SearchResponseDto {
  @ApiProperty({ type: SearchDataDto })
  declare data: SearchDataDto;
}
