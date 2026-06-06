import type { ArchiveDerivationRow } from '@libs/db';
import type { ArchiveEventType } from '@libs/domain';
import type { ActorAddressDeriver } from '@sources/core';
import type { AaveVotingMachineArchivePayloadRow } from '../persistence/archive-payload-repository';
import { AaveVotingMachineArchivePayloadRepository } from '../persistence/archive-payload-repository';

export type AaveVotingMachineActorAddressSource = 'voter_event';

export interface AaveVotingMachineAddressCandidate {
  address: string;
  source: AaveVotingMachineActorAddressSource;
}

const AAVE_VOTING_MACHINE_EVENT_TYPES = [
  'VoteEmitted',
  'ProposalVoteStarted',
  'ProposalResultsSent',
  'ProposalVoteConfigurationBridged',
] as const satisfies readonly ArchiveEventType[];

export class AaveVotingMachineActorAddressDeriver implements ActorAddressDeriver {
  readonly kind = 'actor-address' as const;
  readonly sourceTypes = ['aave_voting_machine'] as const;
  readonly eventTypes = AAVE_VOTING_MACHINE_EVENT_TYPES;

  constructor(private readonly payloads: AaveVotingMachineArchivePayloadRepository) {}

  fetchPayloads(
    rows: readonly ArchiveDerivationRow[],
  ): Promise<readonly AaveVotingMachineArchivePayloadRow[]> {
    return this.payloads.fetchPayloads(rows);
  }

  extractAddresses(
    eventType: ArchiveEventType,
    payloadJson: string,
  ): readonly AaveVotingMachineAddressCandidate[] {
    if (eventType !== 'VoteEmitted') return [];

    const payload = JSON.parse(payloadJson) as Record<string, unknown>;
    const voter = payload['voter'];
    if (typeof voter !== 'string' || !/^0x[a-fA-F0-9]{40}$/.test(voter)) {
      throw new Error('invalid VoteEmitted.voter payload field');
    }

    return [{ address: voter.toLowerCase(), source: 'voter_event' }];
  }
}
