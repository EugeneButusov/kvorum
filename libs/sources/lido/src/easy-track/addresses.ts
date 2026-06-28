// Lido Easy Track — pinned mainnet addresses + activation block. See VERIFICATION.md for the
// on-chain evidence (deployed bytecode is non-proxy / immutable, so event signatures are stable
// across the contract's whole history — no multi-variant decode needed).
//
// Easy Track is Lido's optimistic-motion track: a motion auto-enacts after its objection window
// unless ≥0.5% LDO objects. The ingester watches the EasyTrack contract's motion-lifecycle + settings
// events; the EVMScriptExecutor address is pinned here for the later EVMScript-action decoder, but it
// emits no motion events and is NOT part of the log filter.

export const EASY_TRACK_MAINNET = {
  // EasyTrack — emits every motion-lifecycle + settings event the ingester watches.
  easyTrack: '0xF0211b7660680B49De1A7E9f25C65660F0a13Fea',
  // EVMScriptExecutor — executes an enacted motion's EVMScript via the Aragon Agent. Pinned for the
  // motion-factory EVMScript decoder; not watched for events here.
  evmScriptExecutor: '0xFE5986E06210aC1eCC1aDCafc0cc7f8D63B3F977',
} as const;

// EasyTrack contract-creation block (mainnet). Creation tx
// 0x55c4c7e33eb92da16871944879d52180c1a2e59c2701404abef864c5196ab7f1 (2021-11-24). Earliest block
// that can carry a motion event — the backfill `active_from_block`.
export const EASY_TRACK_ACTIVE_FROM_BLOCK = 13676729;
