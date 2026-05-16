import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../openapi/openapi.dto';

export class DaoLinksDto {
  @ApiProperty()
  declare self: string;
}

export class DaoMetaDto {
  @ApiProperty()
  declare last_updated_at: string;

  @ApiProperty({ type: DaoLinksDto })
  declare links: DaoLinksDto;
}

export class DaoSourceDto {
  @ApiProperty()
  declare source_type: string;

  @ApiPropertyOptional()
  declare contract_address?: string;

  @ApiPropertyOptional()
  declare chain_id?: string;
}

export class DaoListItemDto {
  @ApiProperty()
  declare slug: string;

  @ApiProperty()
  declare name: string;

  @ApiProperty()
  declare description: string;

  @ApiProperty()
  declare website_url: string;

  @ApiProperty()
  declare forum_url: string;

  @ApiProperty()
  declare primary_token_address: string;

  @ApiProperty()
  declare primary_chain_id: string;

  @ApiProperty({ type: DaoMetaDto })
  declare _meta: DaoMetaDto;
}

export class DaoDetailDto extends DaoListItemDto {
  @ApiProperty({ type: () => [DaoSourceDto] })
  declare sources: DaoSourceDto[];
}

export class DaoListResponseDto {
  @ApiProperty({ type: () => [DaoListItemDto] })
  declare data: DaoListItemDto[];

  @ApiProperty({ type: PaginationDto })
  declare pagination: PaginationDto;
}

export class DaoDetailResponseDto {
  @ApiProperty({ type: DaoDetailDto })
  declare data: DaoDetailDto;
}

export class DaoSourceListResponseDto {
  @ApiProperty({ type: () => [DaoSourceDto] })
  declare data: DaoSourceDto[];
}
