import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Query params for `GET …/similar` (SPEC §5.8: cross-DAO default, optional DAO/type/time filters). */
export class SimilarQueryDto {
  @ApiPropertyOptional({ description: 'Narrow to a single DAO by slug (default is cross-DAO).' })
  declare dao?: string;

  @ApiPropertyOptional({ description: 'Narrow to a proposal source_type.' })
  declare type?: string;

  @ApiPropertyOptional({ description: 'Lower bound on the proposal `created_at` (ISO-8601).' })
  declare from?: string;

  @ApiPropertyOptional({ description: 'Upper bound on the proposal `created_at` (ISO-8601).' })
  declare to?: string;

  @ApiPropertyOptional({ type: Number, description: 'Max results, 1–20 (default 10).' })
  declare limit?: number;
}

export class SimilarProposalItemDto {
  @ApiProperty()
  declare dao_slug: string;

  @ApiProperty()
  declare dao_name: string;

  @ApiProperty()
  declare source_type: string;

  @ApiProperty()
  declare source_id: string;

  @ApiProperty({ nullable: true, type: String })
  declare title: string | null;

  @ApiProperty()
  declare state: string;

  @ApiProperty()
  declare created_at: string;

  @ApiProperty({ nullable: true, type: String })
  declare voting_starts_at: string | null;

  @ApiProperty({ nullable: true, type: String })
  declare voting_ends_at: string | null;

  @ApiProperty({ description: 'Cosine similarity in [-1, 1] (1 = identical).' })
  declare similarity: number;
}

export class SimilarProposalsMetaDto {
  @ApiProperty({
    example: true,
    description: 'Always true — labels AI-derived content (SPEC §5.2).',
  })
  declare ai_generated: boolean;

  @ApiProperty({ description: 'The embedding model + composition version the ranking used.' })
  declare embedding_version: string;
}

export class SimilarProposalsResponseDto {
  @ApiProperty({ type: [SimilarProposalItemDto] })
  declare data: SimilarProposalItemDto[];

  @ApiProperty({ type: SimilarProposalsMetaDto })
  declare _meta: SimilarProposalsMetaDto;
}
