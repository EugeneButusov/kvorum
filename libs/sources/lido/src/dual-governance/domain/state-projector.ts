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
 * The veto-signalling timestamps are filled directly from the event `Context` (ADR-0074 §5) — the
 * episode anchors ride the event, so no reconciler RPC is needed:
 *  - `veto_signaling_started_at`   ← `context.vetoSignallingActivatedAt` (the episode's signalling start,
 *    carried on every row in the episode; 0 ⇒ NULL, i.e. no active signalling).
 *  - `veto_signaling_deactivated_at` ← `context.enteredAt` only when the `to` state is the deactivation
 *    sub-state (the moment deactivation began); NULL otherwise.
 * `rage_quit_eth_amount` stays NULL: no rage quit has ever occurred on mainnet
 * (`getRageQuitEscrow() == 0x0`), and the rage-quit Escrow balance getter cannot be live-verified the
 * way the vendored getters were live-verified — so it is deferred (KNOWN-025, ADR-0074 §5).
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

  const ctx = event.payload.context;
  const epochToDate = (seconds: number): Date | null =>
    seconds > 0 ? new Date(seconds * 1000) : null;

  return {
    dao_id: coords.daoId,
    state,
    transition_at: new Date(ctx.enteredAt * 1000),
    block_number: coords.blockNumber,
    tx_hash: coords.txHash,
    log_index: coords.logIndex,
    // KNOWN-025: deferred — no live rage quit; escrow balance getter is not live-verifiable (ADR-0074 §5).
    rage_quit_eth_amount: null,
    veto_signaling_started_at: epochToDate(ctx.vetoSignallingActivatedAt),
    veto_signaling_deactivated_at:
      state === 'veto_signaling_deactivation' ? epochToDate(ctx.enteredAt) : null,
    payload: event.payload,
  };
}
