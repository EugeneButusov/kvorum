import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// Aave proposal extension DTOs: the voting-machine + cross-chain payloads-controller surface that
// Aave's read extension attaches to proposal detail. Assembled into the response by apps/api.
export class ProposalVotingDto {
  @ApiPropertyOptional({ nullable: true })
  declare voting_chain_id: string | null;

  @ApiPropertyOptional({ nullable: true })
  declare voting_machine_address: string | null;

  @ApiPropertyOptional({ nullable: true })
  declare voting_strategy_address: string | null;

  @ApiProperty()
  declare creation_block: string;
}

export class ProposalPayloadDto {
  @ApiProperty()
  declare payload_index: number;

  @ApiProperty()
  declare payload_id: string;

  @ApiProperty()
  declare payloads_controller_address: string;

  @ApiProperty()
  declare status: string;

  @ApiPropertyOptional({ nullable: true })
  declare executed_at_destination: string | null;

  @ApiProperty()
  declare unindexed_target_chain: boolean;
}

export class ProposalPayloadGroupDto {
  @ApiProperty()
  declare target_chain_id: string;

  @ApiProperty({ type: [ProposalPayloadDto] })
  declare payloads: ProposalPayloadDto[];
}
