import { Interface } from 'ethers';

// Vendored from the deployed mainnet EasyTrack proxy-free contract
// 0xF0211b7660680B49De1A7E9f25C65660F0a13Fea (verified ABI). See ../VERIFICATION.md.
//
// One event-emitting contract. EasyTrack inherits MotionSettings + EVMScriptFactoriesRegistry, so the
// settings events (duration / objections-threshold / count-limit) and the executor-change event are
// emitted by the same address as the motion lifecycle. All nine are watched.
//
// Motion lifecycle (the optimistic-objection model — the motion projection maps these onto proposal
// state):
//   MotionCreated → (auto-enact after window) → MotionEnacted
//                 → (≥0.5% LDO objects)        → MotionObjected* → MotionRejected
//                 → (proposer/admin cancels)   → MotionCanceled
// `MotionObjected` is the running objection tally (fires per objection); the terminal transition to
// rejected is `MotionRejected`. The settings events let the projection reconstruct the
// objection-window/threshold timeline without a re-backfill.

const EASY_TRACK_EVENTS = [
  // Motion lifecycle. `MotionCreated` carries the full EVMScript (the EVMScript-action decoder reads
  // it straight from the archived payload) and the per-motion factory address (the factory set is
  // data, not a hardcoded list).
  'event MotionCreated(uint256 indexed _motionId, address _creator, address indexed _evmScriptFactory, bytes _evmScriptCallData, bytes _evmScript)',
  'event MotionObjected(uint256 indexed _motionId, address indexed _objector, uint256 _weight, uint256 _newObjectionsAmount, uint256 _newObjectionsAmountPct)',
  'event MotionRejected(uint256 indexed _motionId)',
  'event MotionCanceled(uint256 indexed _motionId)',
  'event MotionEnacted(uint256 indexed _motionId)',
  // Settings (MotionSettings) + executor wiring (EVMScriptFactoriesRegistry). Archived for complete
  // history; the objection window / threshold are interpreted in derivation, not here.
  'event MotionDurationChanged(uint256 _motionDuration)',
  'event ObjectionsThresholdChanged(uint256 _newThreshold)',
  'event MotionsCountLimitChanged(uint256 _newMotionsCountLimit)',
  'event EVMScriptExecutorChanged(address indexed _evmScriptExecutor)',
] as const;

export const EASY_TRACK_INTERFACE = new Interface([...EASY_TRACK_EVENTS]);

function topic(iface: Interface, name: string): string {
  return iface.getEvent(name)!.topicHash.toLowerCase();
}

export const EASY_TRACK_TOPICS = {
  MotionCreated: topic(EASY_TRACK_INTERFACE, 'MotionCreated'),
  MotionObjected: topic(EASY_TRACK_INTERFACE, 'MotionObjected'),
  MotionRejected: topic(EASY_TRACK_INTERFACE, 'MotionRejected'),
  MotionCanceled: topic(EASY_TRACK_INTERFACE, 'MotionCanceled'),
  MotionEnacted: topic(EASY_TRACK_INTERFACE, 'MotionEnacted'),
  MotionDurationChanged: topic(EASY_TRACK_INTERFACE, 'MotionDurationChanged'),
  ObjectionsThresholdChanged: topic(EASY_TRACK_INTERFACE, 'ObjectionsThresholdChanged'),
  MotionsCountLimitChanged: topic(EASY_TRACK_INTERFACE, 'MotionsCountLimitChanged'),
  EVMScriptExecutorChanged: topic(EASY_TRACK_INTERFACE, 'EVMScriptExecutorChanged'),
} as const;

export type EasyTrackTopics = typeof EASY_TRACK_TOPICS;
