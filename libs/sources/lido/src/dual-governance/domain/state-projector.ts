import { DG_ONCHAIN_STATE_TO_PG } from '../addresses';
import type { DualGovernanceEvent } from './types';
import type { NewDualGovernanceStateHistory } from '../../persistence/schema';

export interface StateChangeCoords {
  daoId: string;
  /** bigint as string */
  blockNumber: string;
  txHash: string;
  logIndex: number;
}

type StateChangedEvent = Extract<DualGovernanceEvent, { type: 'DualGovernanceStateChanged' }>;

/**
 * Projects a decoded DualGovernanceStateChanged event into an append-only history row (ADR-024).
 *
 * `transition_at` is the on-chain `context.enteredAt` — the time the `to` state was entered (the
 * Context carried by the event is the post-transition context), so no block-timestamp read is needed.
 *
 * Only the core columns are populated in AB2. `rage_quit_eth_amount` and the veto-signalling timestamps
 * are NULL here — they need escrow-derived episode semantics and are filled by the AB4 reconciler.
 *
 * The `to` state maps on-chain→PG by NAME (the on-chain enum is offset by `NotInitialized(0)` from the
 * PG enum). `NotInitialized` is pre-init only and never a `to` state; an unmappable to-state throws
 * (→ DLQ) rather than guessing.
 */
export function projectDualGovernanceStateChange(
  event: StateChangedEvent,
  coords: StateChangeCoords,
): NewDualGovernanceStateHistory {
  const onchainTo = event.payload.to;
  const state = DG_ONCHAIN_STATE_TO_PG[onchainTo as keyof typeof DG_ONCHAIN_STATE_TO_PG];
  if (state === undefined) {
    throw new Error(`unmappable Dual Governance to-state: ${onchainTo}`);
  }

  return {
    dao_id: coords.daoId,
    state,
    transition_at: new Date(event.payload.context.enteredAt * 1000),
    block_number: coords.blockNumber,
    tx_hash: coords.txHash,
    log_index: coords.logIndex,
    rage_quit_eth_amount: null,
    veto_signaling_started_at: null,
    veto_signaling_deactivated_at: null,
    payload: event.payload,
  };
}
