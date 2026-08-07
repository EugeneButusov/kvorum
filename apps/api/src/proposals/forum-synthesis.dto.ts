import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// DTOs for `GET …/proposals/{type}/{id}/ai/forum-synthesis` (SPEC §5.4, §5.7). The body mirrors
// ForumSynthesisSchema (@libs/ai); `_meta` sits at the envelope level (sibling of `data`) so a served
// synthesis and a non-English skip — where `data` is null — share one response shape.

const SENTIMENTS = ['favorable', 'mixed', 'unfavorable', 'contentious'] as const;
const THREAD_HEALTH = ['constructive', 'mixed', 'unproductive'] as const;

export class ForumArgumentDto {
  @ApiProperty()
  declare summary: string;

  @ApiProperty({
    type: [String],
    description: 'Handles of participants making this argument (≤5).',
  })
  declare supporting_participants: string[];
}

export class ForumConcernDto {
  @ApiProperty()
  declare summary: string;

  @ApiProperty({ type: [String], description: 'Handles of participants who raised it (≤3).' })
  declare raised_by: string[];
}

export class ForumParticipantDto {
  @ApiProperty()
  declare handle: string;

  @ApiProperty()
  declare role_summary: string;
}

export class ForumSynthesisDto {
  @ApiProperty({ type: [ForumArgumentDto] })
  declare arguments_for: ForumArgumentDto[];

  @ApiProperty({ type: [ForumArgumentDto] })
  declare arguments_against: ForumArgumentDto[];

  @ApiProperty({ type: [ForumConcernDto] })
  declare unresolved_concerns: ForumConcernDto[];

  @ApiProperty({ type: [ForumParticipantDto] })
  declare notable_participants: ForumParticipantDto[];

  @ApiProperty({ enum: SENTIMENTS })
  declare sentiment: (typeof SENTIMENTS)[number];

  @ApiProperty({ enum: THREAD_HEALTH })
  declare thread_health: (typeof THREAD_HEALTH)[number];
}

export class ForumSynthesisMetaDto {
  @ApiProperty({
    example: true,
    description: 'Labels AI-derived content (SPEC §5.2). false when the thread was skipped.',
  })
  declare ai_generated: boolean;

  @ApiPropertyOptional({ description: 'Model that produced the synthesis (Haiku or Sonnet).' })
  declare model?: string;

  @ApiPropertyOptional()
  declare prompt_version?: string;

  @ApiPropertyOptional({ description: 'sha256: of the synthesized thread `raw_content`.' })
  declare input_hash?: string;

  @ApiPropertyOptional()
  declare generated_at?: string;

  @ApiPropertyOptional({
    enum: ['non_english'],
    description: 'Present when the thread was not synthesized (KNOWN-016); `data` is then null.',
  })
  declare skipped_reason?: string;
}

export class ForumSynthesisResponseDto {
  @ApiProperty({ type: ForumSynthesisDto, nullable: true })
  declare data: ForumSynthesisDto | null;

  @ApiProperty({ type: ForumSynthesisMetaDto })
  declare _meta: ForumSynthesisMetaDto;
}
