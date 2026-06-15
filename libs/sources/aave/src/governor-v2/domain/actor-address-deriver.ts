import type { ArchiveDerivationRow } from '@libs/db';
import type { ArchiveEventType } from '@libs/domain';
import type { ActorAddressDeriver } from '@sources/core';
import type { AaveGovernorV2ArchivePayloadRow } from '../persistence/archive-payload-repository';
import { AaveGovernorV2ArchivePayloadRepository } from '../persistence/archive-payload-repository';

export type AaveV2ActorAddressSource = 'proposer_event' | 'voter_event';

export interface AaveV2AddressCandidate {
  address: string;
  source: AaveV2ActorAddressSource;
}

const AAVE_GOVERNOR_V2_EVENT_TYPES = [
  'ProposalCreated',
  'VoteEmitted',
  'ProposalQueued',
  'ProposalExecuted',
  'ProposalCanceled',
] as const satisfies readonly ArchiveEventType[];

export class AaveGovernorV2ActorAddressDeriver implements ActorAddressDeriver {
  readonly kind = 'actor-address' as const;
  readonly sourceTypes = ['aave_governor_v2'] as const;
  readonly eventTypes = AAVE_GOVERNOR_V2_EVENT_TYPES;

  constructor(private readonly payloads: AaveGovernorV2ArchivePayloadRepository) {}

  fetchPayloads(
    rows: readonly ArchiveDerivationRow[],
  ): Promise<readonly AaveGovernorV2ArchivePayloadRow[]> {
    return this.payloads.fetchPayloads(rows);
  }

  extractAddresses(
    eventType: ArchiveEventType,
    payloadJson: string,
  ): readonly AaveV2AddressCandidate[] {
    const payload = JSON.parse(payloadJson) as Record<string, unknown>;

    if (eventType === 'ProposalCreated') {
      const creator = payload['creator'];
      if (typeof creator !== 'string' || !/^0x[a-fA-F0-9]{40}$/.test(creator)) {
        throw new Error('invalid ProposalCreated.creator payload field');
      }
      return [{ address: creator.toLowerCase(), source: 'proposer_event' }];
    }

    if (eventType === 'VoteEmitted') {
      const voter = payload['voter'];
      if (typeof voter !== 'string' || !/^0x[a-fA-F0-9]{40}$/.test(voter)) {
        throw new Error('invalid VoteEmitted.voter payload field');
      }
      return [{ address: voter.toLowerCase(), source: 'voter_event' }];
    }

    return [];
  }
}
