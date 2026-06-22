import type { ArchiveDerivationRow } from '@libs/db';
import type { ArchiveEventType } from '@libs/domain';
import type { ActorAddressDeriver, ActorAddressPayloadRow } from '@sources/core';
import { AragonVotingArchivePayloadRepository } from '../persistence/archive-payload-repository';

export type AragonActorAddressSource = 'proposer_event' | 'voter_event';

export interface AragonAddressCandidate {
  address: string;
  source: AragonActorAddressSource;
}

/**
 * Actor-address sweep for Lido Aragon voting.
 *
 * `eventTypes` enumerates EVERY event the projection appliers process — including
 * the no-actor ExecuteVote + the four Change* config events — because the actor
 * sweep stamps `archive_event.derivation_actor_resolved_at` only for event types
 * it lists, and the projection worker's gate (`findDerivableBy`) requires that
 * stamp. `extractAddresses` returns `[]` for the no-actor events; the sweep still
 * marks them resolved so they pass the gate. (Mirrors Aave governance-v3; the
 * compound narrow extractor that omits its proposal events is the anti-pattern.)
 */
export class LidoAragonVotingActorAddressDeriver implements ActorAddressDeriver {
  readonly kind = 'actor-address' as const;
  readonly sourceTypes = ['aragon_voting'] as const;
  readonly eventTypes = [
    'StartVote',
    'CastVote',
    'CastObjection',
    'ExecuteVote',
    'ChangeSupportRequired',
    'ChangeMinQuorum',
    'ChangeVoteTime',
    'ChangeObjectionPhaseTime',
  ] as const satisfies readonly ArchiveEventType[];

  constructor(private readonly payloads: AragonVotingArchivePayloadRepository) {}

  async fetchPayloads(
    rows: readonly ArchiveDerivationRow[],
  ): Promise<readonly ActorAddressPayloadRow[]> {
    const found = await this.payloads.fetchPayloads(rows);
    return found.map((row) => ({
      chain_id: row.chain_id,
      tx_hash: row.tx_hash,
      log_index: row.log_index,
      block_hash: row.block_hash,
      event_type: row.event_type as ArchiveEventType,
      payload: row.payload,
    }));
  }

  extractAddresses(
    eventType: ArchiveEventType,
    payload: string,
  ): readonly AragonAddressCandidate[] {
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    switch (eventType) {
      case 'StartVote':
        return [
          { address: requireAddress(parsed['creator'], 'creator'), source: 'proposer_event' },
        ];
      case 'CastVote':
      case 'CastObjection':
        return [{ address: requireAddress(parsed['voter'], 'voter'), source: 'voter_event' }];
      default:
        return [];
    }
  }
}

function requireAddress(raw: unknown, field: string): string {
  if (typeof raw !== 'string' || !/^0x[a-fA-F0-9]{40}$/.test(raw)) {
    throw new Error(`invalid Aragon ${field} address payload field`);
  }
  return raw.toLowerCase();
}
