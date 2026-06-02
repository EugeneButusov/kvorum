import type { ArchiveDerivationRow } from '@libs/db';
import type { ArchiveEventType } from '@libs/domain';
import type { ActorAddressDeriver } from '@sources/core';
import type { AaveGovernanceArchivePayloadRow } from '../persistence/archive-payload-repository';
import { AaveGovernanceArchivePayloadRepository } from '../persistence/archive-payload-repository';

export type AaveActorAddressSource = 'proposer_event';

export interface AaveAddressCandidate {
  address: string;
  source: AaveActorAddressSource;
}

const AAVE_GOVERNANCE_V3_EVENT_TYPES = [
  'ProposalCreated',
  'VotingActivated',
  'ProposalQueued',
  'ProposalExecuted',
  'ProposalCanceled',
  'ProposalFailed',
  'PayloadSent',
] as const satisfies readonly ArchiveEventType[];

export class AaveGovernanceActorAddressDeriver implements ActorAddressDeriver {
  readonly kind = 'actor-address' as const;
  readonly sourceTypes = ['aave_governance_v3'] as const;
  readonly eventTypes = AAVE_GOVERNANCE_V3_EVENT_TYPES;

  constructor(private readonly payloads: AaveGovernanceArchivePayloadRepository) {}

  fetchPayloads(
    rows: readonly ArchiveDerivationRow[],
  ): Promise<readonly AaveGovernanceArchivePayloadRow[]> {
    return this.payloads.fetchPayloads(rows);
  }

  extractAddresses(
    eventType: ArchiveEventType,
    payloadJson: string,
  ): readonly AaveAddressCandidate[] {
    if (eventType !== 'ProposalCreated') return [];
    const payload = JSON.parse(payloadJson) as Record<string, unknown>;
    const creator = payload['creator'];
    if (typeof creator !== 'string' || !/^0x[a-fA-F0-9]{40}$/.test(creator)) {
      throw new Error('invalid ProposalCreated.creator payload field');
    }
    return [{ address: creator.toLowerCase(), source: 'proposer_event' }];
  }
}
