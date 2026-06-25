import type { ArchiveDerivationRow } from '@libs/db';
import type { ArchiveEventType } from '@libs/domain';
import type { ActorAddressDeriver, ActorAddressPayloadRow } from '@sources/core';
import { DualGovernanceArchivePayloadRepository } from '../persistence/archive-payload-repository';

// The actor sweep reads `candidate.source` to pick the actor_address source. Mirrors the Aragon
// deriver's local candidate type (the core ActorAddressCandidate carries `role`, not `source`).
interface DualGovernanceAddressCandidate {
  address: string;
  source: 'proposer_event';
}

/**
 * Actor-address sweep for Lido Dual Governance.
 *
 * The projection worker's gate (`findDerivableBy`) only releases archive rows whose
 * `derivation_actor_resolved_at` is stamped, and the actor sweep stamps a row only for event types an
 * adapter lists — stamping unconditionally even when `extractAddresses` returns `[]`. So this adapter
 * must list every event the DG projection processes.
 *
 * `DualGovernanceStateChanged` has no governance actor (a transition is not attributable to a
 * voter/proposer), so it returns `[]` — the sweep still marks the row resolved, letting the
 * state-history applier (AB2) run. AB3 adds the proposal-flow events the proposal applier derives: the
 * DG `ProposalSubmittedMeta` carries the proposer account; the Timelock id-only events and the
 * calls-carrying `ProposalSubmitted` (whose `executor` is the AdminExecutor contract, not a
 * participant) have none, so they resolve to `[]` and are still released to the applier.
 */
export class LidoDualGovernanceActorAddressDeriver implements ActorAddressDeriver {
  readonly kind = 'actor-address' as const;
  readonly sourceTypes = ['dual_governance'] as const;
  readonly eventTypes = [
    'DualGovernanceStateChanged',
    'ProposalSubmitted',
    'ProposalScheduled',
    'ProposalExecuted',
    'ProposalsCancelledTill',
    'ProposalSubmittedMeta',
  ] as const satisfies readonly ArchiveEventType[];

  constructor(private readonly payloads: DualGovernanceArchivePayloadRepository) {}

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
  ): readonly DualGovernanceAddressCandidate[] {
    if (eventType === 'ProposalSubmittedMeta') {
      const parsed = JSON.parse(payload) as { proposerAccount?: string };
      if (typeof parsed.proposerAccount === 'string') {
        return [{ address: parsed.proposerAccount.toLowerCase(), source: 'proposer_event' }];
      }
      return [];
    }
    // State transitions, the Timelock id-only events, and the calls-carrying ProposalSubmitted have no
    // participant address (escrow/config/executor in payloads are contracts). [] still lets the sweep
    // mark the row resolved so the projection appliers run.
    return [];
  }
}
