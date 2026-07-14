import { ApiProperty } from '@nestjs/swagger';

export class ProposalTallyChoiceDto {
  @ApiProperty()
  declare choice_index: number;

  @ApiProperty({
    type: String,
    description:
      'Summed voting power for the choice. UInt256 base units when source=votes; the raw ' +
      'per-choice score when source=choice_scores — interpret via `source`.',
  })
  declare voting_power: string;

  @ApiProperty()
  declare voter_count: number;

  @ApiProperty({ description: 'Share of participating power, 0–100, to two decimals.' })
  declare pct: number;
}

export class ProposalTallyDto {
  @ApiProperty({ type: () => [ProposalTallyChoiceDto] })
  declare choices: ProposalTallyChoiceDto[];

  @ApiProperty({ type: String })
  declare total_voting_power: string;

  @ApiProperty()
  declare total_voters: number;

  @ApiProperty({
    enum: ['votes', 'choice_scores'],
    description:
      'Where the tally came from: `votes` (summed primary_choice) or `choice_scores` (a ' +
      'source-provided per-choice breakdown for approval/weighted proposals).',
  })
  declare source: 'votes' | 'choice_scores';
}

export class ProposalTallyResponseDto {
  @ApiProperty({ type: ProposalTallyDto })
  declare data: ProposalTallyDto;
}
