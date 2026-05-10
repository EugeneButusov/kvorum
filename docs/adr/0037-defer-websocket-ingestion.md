# ADR-037 — Defer WebSocket ingestion to v1.x; v1 uses polling only

- **Status**: Accepted
- **Date**: 2026-05-10
- **Spec sections affected**: 3.3
- **Related**: M1 plan (`docs/plan-m1.md`), KNOWN-001

## Context

SPEC §3.3 commits to a dual-path live ingestion design:

- **WebSocket** subscription via `eth_subscribe('logs', filter)` for low-latency event delivery, plus `eth_subscribe('newHeads')` for block-confirmation tracking.
- **Polling fallback** via `eth_getLogs` over the recently-finalized window, running in parallel as a defense against missed WebSocket events.

The justification in the spec: "WebSockets are convenient but unreliable in practice; `eth_getLogs` is reliable but lacks low-latency. Running both gives Kvorum both properties."

That reasoning is sound _if_ low-latency is actually a product requirement. It isn't, in v1:

- **Reorg horizon dominates the latency budget.** On Ethereum mainnet, the v1 reorg horizon is 12 confirmations × ~12s/block = ~2.5 minutes. Until an event is past the horizon, it has `confirmation_status = 'pending'` and is _not_ surfaced through the public API or dashboard (KNOWN-001 / SPEC §3.4 confirmed-only visibility). Sub-minute event _detection_ is invisible to users when sub-2.5-minute event _publication_ is structurally impossible.
- **M1's acceptance criterion #2 commits to 4 minutes**, not 4 seconds. Polling at 12-second cadence (matching mainnet block time) detects new events within 12 seconds; combined with the reorg horizon and a few seconds of processing, total visibility lag is ~2.5–3 minutes. Comfortably under the budget.
- **The product domain doesn't reward sub-minute detection.** Governance proposals open for hours or days. Compound voting periods are 3 days. Aave's are similar. The audience that genuinely benefits from sub-minute pending visibility is the same narrow audience addressed by KNOWN-001 — researchers watching contentious votes in real-time — and that path is explicitly v1.1+.

Implementing the dual-path design adds: a WebSocket subscription manager, exponential-backoff reconnect logic, gap-fill reconciliation against the polling stream after reconnect, per-provider WebSocket health monitoring, and the operational discipline of debugging silent WS dropouts in production. Free-tier WebSocket endpoints from common RPC providers (Alchemy, Ankr, public RPCs) are flaky in practice — exactly the failure mode SPEC §3.3 itself acknowledges by mandating the polling fallback.

The bargain isn't earned at v1 scale. v1 carries the operational cost of a transport whose latency benefit the product doesn't surface.

## Decision

**v1 ships polling-only EVM ingestion.** The implementation:

- **Event polling.** Each EVM source's `EVMEventIngester` calls `eth_getLogs` with a sliding window covering the last `N` blocks (default `N = 2 × reorg_horizon`, bounded by RPC `eth_getLogs` page limits). Events landing in the window are written to the archive idempotently via the `(chain_id, tx_hash, log_index, block_hash)` UNIQUE key. Polling cadence: every 12 seconds for live tracking (matches Ethereum mainnet block time; longer-block-time chains may use chain-specific cadences).
- **Head tracking.** `eth_getBlockByNumber('latest')` is called on the same cadence to drive the sliding-window block-hash tracker (the reorg detector). The detector's mechanics from SPEC §3.4 are unchanged — only its _driver_ shifts from a WebSocket subscription to a polled call.
- **Confirmation promotion sweep.** Unchanged from SPEC §3.4. Still runs every 30 seconds inside `apps/indexer`.
- **Backfill.** Unchanged. Already polling-based per SPEC §3.10.

The `ChainClient` interface in `libs/chain` remains transport-pluggable: a future `WebSocketChainClient` is additive, not a rewrite.

**Forward-compatibility commitment.** When WebSocket ingestion becomes valuable — most plausibly accompanying KNOWN-001's v1.1 pending-event visibility, where users opt in to sub-confirmation latency — the implementation slots into the existing `ChainClient` interface. No schema or API breaking changes are required. The dual-path design SPEC §3.3 describes is preserved as a future state, not a v1 requirement.

## Alternatives considered

- **Ship dual-path WS+polling per SPEC §3.3 verbatim.** Rejected. The operational surface (flaky free-tier WS endpoints, reconnect bugs, gap-fill correctness, silent WS dropouts) is not earned by latency the product doesn't need. M1's E3 task estimate drops from ~6h to ~3h by eliminating WS scope; ongoing operational complexity drops further.
- **Drop polling, ship WebSocket-only.** Rejected. SPEC §3.3 itself acknowledges WS unreliability ("convenient but unreliable in practice"). A WS-only path would be a worse product than polling-only for the same reasons.
- **Tighten polling cadence to 1–5 seconds for sub-minute detection.** Considered. Possible if a future requirement justifies it, but at v1 scale this consumes RPC quota for no product benefit. v1 stays at 12-second cadence.
- **Build the WS abstraction now but don't enable it.** Rejected as design-for-future-needs. The `ChainClient` interface staying transport-pluggable is sufficient; a phantom WS implementation gathering dust would rot.

## Consequences

- **M1 effort drops by ~3h** in Epic E's E3 task (was "WebSocket subscription + polling fallback + idempotency key" at ~6h; becomes "Polling ingestion + head tracking + idempotency key" at ~3h). M1 raw effort drops from ~15.5d to ~14.5d.
- **Operational risk drops.** The "WS message loss during reconnect" concern from SPEC §3.3 is structurally absent. Free-tier WS endpoint flakiness is no longer a runtime concern.
- **Latency stays well within M1's 4-minute target.** Mainnet block time (12s) + reorg horizon (12 × 12s = 144s) + processing (~5–15s) = ~2.75–3 minutes worst case. Under budget.
- **`apps/indexer` is simpler.** One transport, one cadence, one set of metrics. The `kvorum_ingestion_ws_reconnects_total` metric originally planned in M1 is removed.
- **Reorg detection is unchanged in correctness terms.** The sliding-window block-hash tracker fires on `parent_hash` mismatch regardless of how the head events arrive. The Anvil synthetic-reorg test (M1 acceptance criterion #3) is not affected.
- **SPEC §3.3 receives a clarifying amendment** noting that v1 ships polling-only and dual-path is a v1.x extension. Future ADRs (most likely paired with KNOWN-001's resolution) will describe re-enabling WS when the product surface justifies it.
- **The forward-compat commitment is real, not symbolic.** The `ChainClient` interface admits new transport implementations without changing consumer code in `apps/indexer/sources/*`.

## Implementation notes (M1-specific)

- E3 retitled: "Polling ingestion + head tracking + idempotency key"
- E4's `kvorum_ingestion_ws_reconnects_total` metric removed; head-tracking emits `kvorum_ingestion_head_poll_lag_seconds` instead (gauge: time since last successful `eth_getBlockByNumber('latest')` per chain).
- F1 retitled to drop "live WS path"; archive writer has one path (polling).
- The Anvil synthetic-reorg test in F3 drives reorg injection by manipulating Anvil's chain state; the indexer detects it on the next polled head — unchanged correctness, simpler test setup.
