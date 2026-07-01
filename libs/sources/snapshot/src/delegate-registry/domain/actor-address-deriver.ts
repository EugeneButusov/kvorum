import type { ArchiveDerivationRow } from '@libs/db';
import { ZERO_DELEGATE_ADDRESS } from '@libs/db';
import type { ArchiveEventType } from '@libs/domain';
import type { ActorAddressDeriver } from '@sources/core';
import type { DelegateRegistryArchivePayloadRow } from '../persistence/archive-payload-repository';
import { DelegateRegistryArchivePayloadRepository } from '../persistence/archive-payload-repository';

export type DelegateRegistryActorSource = 'delegator_event' | 'delegate_event';

export interface DelegateRegistryAddressCandidate {
  address: string;
  source: DelegateRegistryActorSource;
}

const EVENT_TYPES = ['SetDelegate', 'ClearDelegate'] as const satisfies readonly ArchiveEventType[];
const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

export class DelegateRegistryActorAddressDeriver implements ActorAddressDeriver {
  readonly kind = 'actor-address' as const;
  readonly sourceTypes = ['snapshot_delegate_registry'] as const;
  readonly eventTypes = EVENT_TYPES;

  constructor(private readonly payloads: DelegateRegistryArchivePayloadRepository) {}

  fetchPayloads(
    rows: readonly ArchiveDerivationRow[],
  ): Promise<readonly DelegateRegistryArchivePayloadRow[]> {
    return this.payloads.fetchPayloads(rows);
  }

  extractAddresses(
    eventType: ArchiveEventType,
    payloadJson: string,
  ): readonly DelegateRegistryAddressCandidate[] {
    if (eventType !== 'SetDelegate' && eventType !== 'ClearDelegate') return [];

    const payload = JSON.parse(payloadJson) as Record<string, unknown>;
    const candidates: DelegateRegistryAddressCandidate[] = [
      asCandidate(payload['delegator'], 'delegator_event'),
    ];

    const delegate = payload['delegate'];
    if (
      typeof delegate === 'string' &&
      ADDRESS_RE.test(delegate) &&
      delegate.toLowerCase() !== ZERO_DELEGATE_ADDRESS
    ) {
      candidates.push({ address: delegate.toLowerCase(), source: 'delegate_event' });
    }

    return candidates;
  }
}

function asCandidate(
  raw: unknown,
  source: DelegateRegistryActorSource,
): DelegateRegistryAddressCandidate {
  if (typeof raw !== 'string' || !ADDRESS_RE.test(raw)) {
    throw new Error(`invalid Delegate Registry ${source} payload field`);
  }
  return { address: raw.toLowerCase(), source };
}
