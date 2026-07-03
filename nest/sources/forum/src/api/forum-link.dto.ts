import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// Forum-link DTO (cross-source; sourced from proposal_forum_link ⨝ forum_thread). Attached to
// proposal detail by apps/api via the forum-link reader.
export class ProposalForumLinkDto {
  @ApiProperty()
  declare forum_host: string;

  @ApiProperty()
  declare forum_topic_id: string;

  @ApiPropertyOptional({ nullable: true })
  declare title: string | null;

  @ApiProperty()
  declare url: string;

  @ApiProperty({ enum: ['high', 'medium', 'low'] })
  declare confidence: 'high' | 'medium' | 'low';

  @ApiPropertyOptional({ nullable: true })
  declare last_activity_at: string | null;
}
