# ADR-027 — Backfill confirmation cutoff rule

- **Status**: Superseded in part by ADR-046 (2026-05-16) — the cutoff-boundary formula changes from `1 × reorg_horizon` to `2 × reorg_horizon`. The capture-once / rehydrate-on-resume / never-refresh determinism rule below is **unchanged and still authoritative**.
- **Date**: 2026-05-08 (proposed); 2026-05-10 (accepted, ratified by `dao_source.backfill_started_at_block` column + `archive_confirmation` write semantics in `docs/plan-m1-e1.md` v3)
- **Spec sections affected**: 3.10
- **Related**: DR-006

## Context

SPEC §3.10 says backfill writes events directly with `confirmation_status = 'confirmed'`, "bypassing the pending lifecycle… because backfill operates on historical (deeply confirmed) blocks." It does not specify the boundary block at which backfill should switch from writing `confirmed` to writing `pending`.

This matters at the meeting point between backfill and live ingestion. If the rule is "always confirmed during backfill," a backfill that runs to within seconds of chain head will mark live-zone events as confirmed without waiting for the reorg horizon — bypassing the very correctness guarantee the lifecycle exists to provide. If the rule is "always pending," backfill generates millions of pending → confirmed transitions for ancient events, doing pointless work.

## Decision

> **Amended by ADR-046 (2026-05-16):** the boundary below is now `chain_head_at_backfill_start − 2 × reorg_horizon` (was `1 ×`). Read this section with that substitution; everything else here still governs.

A backfill chunk writes events with `confirmation_status` determined per event:

```
if event.block_number <= chain_head_at_backfill_start - reorg_horizon[chain]:
    confirmation_status = 'confirmed'
    confirmed_at = now()
else:
    confirmation_status = 'pending'
    -- normal live-ingestion lifecycle takes over
```

`chain_head_at_backfill_start` is captured once at the beginning of the backfill run and reused across chunks. It is _not_ refreshed per chunk: refreshing would cause the same physical block to be classified differently across runs, creating subtle non-idempotency.

When the backfill resumes after a crash (per §3.10's checkpoint mechanism), the original `chain_head_at_backfill_start` is rehydrated from `dao_source.backfill_started_at_block` (NEW field). Restarting a fresh backfill (operator-triggered) captures a new head and resets the cutoff.

The reorg horizons in §3.4 (12 / 128 / 40 / 40 / 30 / 40 confirmations for Ethereum / Polygon / Arbitrum / Optimism / Avalanche / Base) are the per-chain `reorg_horizon` values referenced above.

## Alternatives considered

- **Use `chain_head_now − reorg_horizon` per chunk.** The boundary moves during backfill; a block 12 confirmations deep at the start of the chunk might be 50 confirmations deep by the end. Same physical block could be classified differently across runs. Idempotency is preserved by the natural key, but the `confirmation_status` written depends on timing — undesirable for replay determinism.
- **Always write `pending` during backfill.** Correct but does extra work; backfill of a year of events generates a year of pending → confirmed transitions for events that are unambiguously final. The promotion sweep (§3.4) is set-based and cheap, but the bookkeeping is unnecessary.
- **Use a fixed cutoff like "last 1000 blocks always pending."** Conflates the reorg horizon (the actual safety boundary) with an arbitrary number. Fragile when chains differ.

## Consequences

- Backfill is fast and idempotent: the same input always produces the same output.
- The handoff between backfill and live ingestion is seamless: live ingestion picks up at the chain head and writes pending; backfill stops at `chain_head_at_backfill_start − reorg_horizon` and writes confirmed; the gap in between is filled by live ingestion as those blocks confirm.
- Idempotency on `(chain_id, tx_hash, log_index, block_hash)` (per §3.3) handles the rare case where a block lands in both the backfill window and the live window — the second write is a no-op.
- §3.10 gains the cutoff rule as an explicit subsection. The `dao_source` schema gains `backfill_started_at_block` (nullable; populated when a backfill is in progress, NULL when no backfill is active or when the active one has completed).
