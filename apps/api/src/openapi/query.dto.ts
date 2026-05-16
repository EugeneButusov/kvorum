import { ApiPropertyOptional } from '@nestjs/swagger';

export class ApiListQueryDto {
  @ApiPropertyOptional({ type: Number })
  declare limit?: number;

  @ApiPropertyOptional()
  declare cursor?: string;

  @ApiPropertyOptional({
    description: 'Comma-delimited sort fields (prefix with - for desc)',
    example: 'slug,-created_at',
  })
  declare sort?: string;

  @ApiPropertyOptional({ description: 'Comma-delimited DAO slugs' })
  declare dao?: string;

  @ApiPropertyOptional({ description: 'Comma-delimited proposal states' })
  declare state?: string;

  @ApiPropertyOptional()
  declare source_type?: string;

  @ApiPropertyOptional({ description: '0x-prefixed proposer address' })
  declare proposer?: string;

  @ApiPropertyOptional({ type: Boolean })
  declare binding?: boolean;

  @ApiPropertyOptional({ type: String })
  declare voting_starts_at_min?: string;

  @ApiPropertyOptional({ type: String })
  declare voting_starts_at_max?: string;
}
