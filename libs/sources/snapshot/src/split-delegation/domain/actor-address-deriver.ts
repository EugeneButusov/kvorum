import type { ArchiveDerivationRow } from '@libs/db';
import { ZERO_DELEGATE_ADDRESS } from '@libs/db';
import type { ArchiveEventType } from '@libs/domain';
import type { ActorAddressDeriver } from '@sources/core';
import type { SplitDelegationEntry } from './types';
import { bytes32ToAddress } from '../../delegation/address';
import type { SplitDelegationArchivePayloadRow } from '../persistence/archive-payload-repository';
import { SplitDelegationArchivePayloadRepository } from '../persistence/archive-payload-repository';

export type SplitDelegationActorSource = 'delegator_event' | 'delegate_event';

export interface SplitDelegationAddressCandidate {
  address: string;
  source: SplitDelegationActorSource;
}

const EVENT_TYPES = [
  'DelegationUpdated',
  'DelegationCleared',
  'ExpirationUpdated',
  'OptOutStatusSet',
] as const satisfies readonly ArchiveEventType[];

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

export class SplitDelegationActorAddressDeriver implements ActorAddressDeriver {
  readonly kind = 'actor-address' as const;
  readonly sourceTypes = ['snapshot_split_delegation'] as const;
  readonly eventTypes = EVENT_TYPES;

  constructor(private readonly payloads: SplitDelegationArchivePayloadRepository) {}

  fetchPayloads(
    rows: readonly ArchiveDerivationRow[],
  ): Promise<readonly SplitDelegationArchivePayloadRow[]> {
    return this.payloads.fetchPayloads(rows);
  }

  extractAddresses(
    eventType: ArchiveEventType,
    payloadJson: string,
  ): readonly SplitDelegationAddressCandidate[] {
    const payload = JSON.parse(payloadJson) as Record<string, unknown>;
    const candidates: SplitDelegationAddressCandidate[] = [];

    if (eventType === 'OptOutStatusSet') {
      pushAddress(candidates, payload['delegate'], 'delegate_event');
      return candidates;
    }

    pushAddress(candidates, payload['account'], 'delegator_event');

    if (eventType === 'DelegationUpdated' || eventType === 'ExpirationUpdated') {
      const delegation = (payload['delegation'] as SplitDelegationEntry[] | undefined) ?? [];
      for (const entry of delegation) {
        const address = bytes32ToAddress(entry.delegate);
        if (address !== null && address !== ZERO_DELEGATE_ADDRESS) {
          candidates.push({ address, source: 'delegate_event' });
        }
      }
    }

    return candidates;
  }
}

function pushAddress(
  candidates: SplitDelegationAddressCandidate[],
  raw: unknown,
  source: SplitDelegationActorSource,
): void {
  if (
    typeof raw === 'string' &&
    ADDRESS_RE.test(raw) &&
    raw.toLowerCase() !== ZERO_DELEGATE_ADDRESS
  ) {
    candidates.push({ address: raw.toLowerCase(), source });
  }
}
