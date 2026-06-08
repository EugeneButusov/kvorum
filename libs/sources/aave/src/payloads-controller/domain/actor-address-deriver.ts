import type { ArchiveDerivationRow } from '@libs/db';
import type { ArchiveEventType } from '@libs/domain';
import type { ActorAddressDeriver } from '@sources/core';
import type { AavePayloadsControllerArchivePayloadRow } from '../persistence/archive-payload-repository';
import { AavePayloadsControllerArchivePayloadRepository } from '../persistence/archive-payload-repository';

const AAVE_PAYLOAD_EVENT_TYPES = [
  'PayloadCreated',
  'PayloadQueued',
  'PayloadExecuted',
  'PayloadCancelled',
] as const;

export class AavePayloadsControllerActorAddressDeriver implements ActorAddressDeriver {
  readonly kind = 'actor-address' as const;
  readonly sourceTypes = ['aave_payloads_controller'] as const;
  readonly eventTypes = AAVE_PAYLOAD_EVENT_TYPES;

  constructor(private readonly payloads: AavePayloadsControllerArchivePayloadRepository) {}

  fetchPayloads(
    rows: readonly ArchiveDerivationRow[],
  ): Promise<readonly AavePayloadsControllerArchivePayloadRow[]> {
    return this.payloads.fetchPayloads(rows);
  }

  extractAddresses(_eventType: ArchiveEventType, _payload: string): readonly [] {
    return [];
  }
}
