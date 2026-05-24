# ADR-046 — Backfill confirmation cutoff uses `2 × head_lag`

- **Status**: Superseded by ADR-058 (2026-05-24)
- **Date**: 2026-05-16
- **Spec sections affected**: 3.10, 3.4
- **Supersedes in part**: ADR-027 (the cutoff-boundary formula only; ADR-027's capture-once / rehydrate-on-resume / never-refresh determinism rule is unchanged and still authoritative)
- **Related**: ADR-027, ADR-037, ADR-041, DR-006

## Context

ADR-027 set the backfill confirmation boundary at:

```
event.block_number <= chain_head_at_backfill_start − head_lag[chain]   ⇒ confirmed
```

Since ADR-027 was accepted, the live ingestion path landed (F1/F2) and fixed the concrete shape of the reorg-rescan window. The live `EventPoller` (`libs/chain/src/poller/event-poller.ts`) re-polls a sliding window whose lower bound is `head − 2 × head_lag`, not `head − head_lag`. The extra `head_lag` of overlap is a deliberate margin so a poller that falls behind by up to `head_lag` blocks still re-scans everything inside the true head lag.

This creates a boundary mismatch ADR-027 could not have anticipated. With the `1 ×` cutoff, events in the half-open interval

```
(chain_head_at_backfill_start − 2·H ,  chain_head_at_backfill_start − H]      (H = head_lag)
```

are written `confirmed` by backfill while the _same physical blocks_ are still inside the live poller's active rescan window. Backfill asserts finality on blocks the live path still treats as eligible for re-evaluation. Idempotency (ADR-041, `(chain_id, tx_hash, log_index, block_hash)`) keeps this from corrupting data — the live re-fetch of those blocks no-ops on the existing rows — but it leaves the system asserting two different things about the same blocks at the same time, and it makes the backfill/live handoff depend on a timing argument ("by the time backfill processes a block, current head has advanced past capture, so `capture − H` is genuinely buried") rather than on a structural invariant. That timing argument is true in the common case but is exactly the kind of implicit reasoning that produces subtle correctness bugs under operator-driven re-runs and long-paused resumes.

I1 (the backfill driver, issue #40) forces the question because the driver must commit to one boundary and guard it with a determinism test.

## Decision

The backfill confirmation cutoff is amended to `2 × head_lag`:

```
if event.block_number <= chain_head_at_backfill_start − 2 · head_lag[chain]:
    confirmation_status = 'confirmed'
    confirmed_at = now()
else:
    confirmation_status = 'pending'
    -- normal live-ingestion lifecycle takes over
```

Everything else in ADR-027 stands unchanged and remains the governing text:

- `chain_head_at_backfill_start` is still captured exactly once at the start of a fresh backfill run, persisted to `dao_source.backfill_started_at_block`, rehydrated verbatim on crash-resume, and **never refreshed** per chunk or per resume.
- A fresh, operator-triggered backfill still captures a new head and resets the cutoff.
- The per-chain `head_lag` values remain those in SPEC §3.4 (12 / 128 / 40 / 40 / 30 / 40 for Ethereum / Polygon / Arbitrum / Optimism / Avalanche / Base). Only the multiplier changes.

The boundary block is `confirmed` when `block_number == capture − 2·H` exactly (the comparison stays `<=`).

## Alternatives considered

- **Keep ADR-027's `1 × head_lag`.** Defensible on pure finality grounds: a block `head_lag` deep is, by the system's reorg model, final, and the live `2×` window is only a poller-lag safety margin, not a claim that such blocks can still reorg. Rejected because correctness then rests on a temporal argument ("backfill always processes a block well after its capture-relative depth exceeds `H`") that is fragile under paused/resumed runs and operator re-triggers, and because it leaves backfill and live asserting different states about the same blocks during the handoff. The `2×` rule removes the argument entirely: the `confirmed` set backfill writes is, by construction, strictly below the live poller's rescan floor, so the two paths never make competing claims about any block.
- **Make the multiplier configurable per source/chain.** Rejected as premature: the live poller's rescan floor is `2 × head_lag` for every chain by construction, so the correct cutoff is structurally `2 × head_lag` for every chain. A knob would only invite drift between the two windows.
- **Move the live poller's rescan floor to `1 × head_lag` to match ADR-027 instead.** Rejected: the `2×` overlap is load-bearing reorg-safety for the live path (poller-lag tolerance); shrinking it to make backfill's arithmetic simpler would trade a benign bookkeeping cost for a real liveness/correctness risk.

## Consequences

- **Backfill and live never make competing finality claims about the same block.** The `confirmed` ceiling backfill writes (`capture − 2·H`) sits at or below the live poller's rescan floor (`current_head − 2·H`, and `current_head ≥ capture` once backfill is running). The interval `(capture − 2·H, capture]` is owned entirely by live ingestion's pending → confirmed lifecycle. The handoff is now a structural invariant, not a timing coincidence.
- **A bounded, one-time band of events is written `pending` instead of `confirmed`.** Exactly the `head_lag`-sized band `(capture − 2·H, capture − H]` shifts from `confirmed` (under ADR-027) to `pending`. This is a single band at the single backfill/live boundary — _not_ across the historical range — and it is reconciled by the existing set-based §3.4 promotion sweep, which is cheap. Backfill of deep history is unaffected: those events are still written `confirmed` directly.
- **ADR-027's idempotency and seamless-handoff consequences still hold**, now without relying on the natural-key no-op to paper over a window where the two paths disagree.
- **I1 determinism test.** The I1 driver's crash-resume test asserts the rehydrated cutoff equals `original_capture − 2 · head_lag` and that no `eth_blockNumber` call occurs on resume — guarding both this amendment and ADR-027's never-refresh rule.
- **No SPEC edit.** `docs/SPEC.md` stays frozen at v1.0; per the ADR process this amendment plus the I1 implementation docs are the canonical record. The README index marks ADR-027 superseded-in-part by this ADR.
