import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// A link from a proposal to an off-chain discussion where it is debated (today a Discourse forum
// thread; the shape is medium-neutral). Attached to proposal detail by apps/api via the forum
// source's read extension.
export class OffchainDiscussionLinkDto {
  @ApiProperty()
  declare platform: string;

  @ApiProperty()
  declare host: string;

  @ApiProperty()
  declare url: string;

  @ApiPropertyOptional({ nullable: true })
  declare title: string | null;

  @ApiProperty({ enum: ['high', 'medium', 'low'] })
  declare confidence: 'high' | 'medium' | 'low';

  @ApiPropertyOptional({ nullable: true })
  declare last_activity_at: string | null;
}
