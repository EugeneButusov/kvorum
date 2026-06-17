import type { ArchiveDerivationRow } from '@libs/db';
import type { ArchiveEventType } from '@libs/domain';
import type { ActorAddressDeriver } from '@sources/core';
import type { AaveTokenArchivePayloadRow } from '../persistence/archive-payload-repository';
import { AaveTokenArchivePayloadRepository } from '../persistence/archive-payload-repository';

export type AaveTokenActorAddressSource = 'delegator_event' | 'delegate_event';

export interface AaveTokenAddressCandidate {
  address: string;
  source: AaveTokenActorAddressSource;
}

const AAVE_TOKEN_EVENT_TYPES = ['DelegateChanged'] as const satisfies readonly ArchiveEventType[];

export class AaveTokenActorAddressDeriver implements ActorAddressDeriver {
  readonly kind = 'actor-address' as const;
  readonly sourceTypes = ['aave_token'] as const;
  readonly eventTypes = AAVE_TOKEN_EVENT_TYPES;

  constructor(private readonly payloads: AaveTokenArchivePayloadRepository) {}

  fetchPayloads(
    rows: readonly ArchiveDerivationRow[],
  ): Promise<readonly AaveTokenArchivePayloadRow[]> {
    return this.payloads.fetchPayloads(rows);
  }

  extractAddresses(
    eventType: ArchiveEventType,
    payloadJson: string,
  ): readonly AaveTokenAddressCandidate[] {
    if (eventType !== 'DelegateChanged') return [];

    const payload = JSON.parse(payloadJson) as Record<string, unknown>;
    const candidates: AaveTokenAddressCandidate[] = [
      asCandidate(payload['delegator'], 'delegator_event'),
    ];

    // delegatee is address(0) for undelegation; only materialize a real delegate actor.
    const delegatee = payload['delegatee'];
    if (typeof delegatee === 'string' && /^0x[a-fA-F0-9]{40}$/.test(delegatee)) {
      if (delegatee.toLowerCase() !== '0x0000000000000000000000000000000000000000') {
        candidates.push({ address: delegatee.toLowerCase(), source: 'delegate_event' });
      }
    }

    return candidates;
  }
}

function asCandidate(raw: unknown, source: AaveTokenActorAddressSource): AaveTokenAddressCandidate {
  if (typeof raw !== 'string' || !/^0x[a-fA-F0-9]{40}$/.test(raw)) {
    throw new Error(`invalid DelegateChanged.${source} payload field`);
  }
  return { address: raw.toLowerCase(), source };
}
