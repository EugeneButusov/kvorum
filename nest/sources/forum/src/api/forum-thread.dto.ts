import { ApiProperty } from '@nestjs/swagger';

export class ForumThreadLinkedProposalDto {
  @ApiProperty()
  declare source_type: string;

  @ApiProperty()
  declare source_id: string;

  @ApiProperty({ nullable: true })
  declare title: string | null;

  @ApiProperty({ enum: ['high', 'medium', 'low'] })
  declare confidence: 'high' | 'medium' | 'low';
}

export class ForumThreadDto {
  @ApiProperty({ description: 'Discourse topic id (the {external_id} in the URL).' })
  declare external_id: string;

  @ApiProperty()
  declare host: string;

  @ApiProperty({ description: 'Canonical link to the thread on the source Discourse instance.' })
  declare source_url: string;

  @ApiProperty({ nullable: true })
  declare title: string | null;

  @ApiProperty({
    nullable: true,
    description: 'Concatenated post bodies (the ingested thread content); no per-post breakdown.',
  })
  declare raw_content: string | null;

  @ApiProperty({ nullable: true })
  declare post_count: number | null;

  @ApiProperty({ nullable: true })
  declare last_activity_at: string | null;

  @ApiProperty({ type: () => [ForumThreadLinkedProposalDto] })
  declare linked_proposals: ForumThreadLinkedProposalDto[];
}

export class ForumThreadResponseDto {
  @ApiProperty({ type: ForumThreadDto })
  declare data: ForumThreadDto;
}
