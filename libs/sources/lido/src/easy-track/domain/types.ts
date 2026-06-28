// Decoded Easy Track event union. Payloads hold archive-faithful primitives: addresses lowercased,
// uints as decimal strings, bytes as 0x-hex.
//
// All events are emitted by the single EasyTrack contract. The motion-lifecycle events drive the
// optimistic-objection proposal mapping; the settings events carry the duration/threshold/limit
// timeline; `EVMScriptExecutorChanged` records executor rewiring.

export interface MotionCreatedPayload {
  motionId: string;
  creator: string;
  evmScriptFactory: string;
  evmScriptCallData: string;
  evmScript: string;
}

export interface MotionObjectedPayload {
  motionId: string;
  objector: string;
  weight: string;
  newObjectionsAmount: string;
  newObjectionsAmountPct: string;
}

export interface MotionIdPayload {
  motionId: string;
}

export interface MotionDurationChangedPayload {
  motionDuration: string;
}

export interface ObjectionsThresholdChangedPayload {
  newThreshold: string;
}

export interface MotionsCountLimitChangedPayload {
  newMotionsCountLimit: string;
}

export interface EvmScriptExecutorChangedPayload {
  evmScriptExecutor: string;
}

export type EasyTrackEvent =
  | { type: 'MotionCreated'; payload: MotionCreatedPayload }
  | { type: 'MotionObjected'; payload: MotionObjectedPayload }
  | { type: 'MotionRejected'; payload: MotionIdPayload }
  | { type: 'MotionCanceled'; payload: MotionIdPayload }
  | { type: 'MotionEnacted'; payload: MotionIdPayload }
  | { type: 'MotionDurationChanged'; payload: MotionDurationChangedPayload }
  | { type: 'ObjectionsThresholdChanged'; payload: ObjectionsThresholdChangedPayload }
  | { type: 'MotionsCountLimitChanged'; payload: MotionsCountLimitChangedPayload }
  | { type: 'EVMScriptExecutorChanged'; payload: EvmScriptExecutorChangedPayload };

export type EasyTrackEventType = EasyTrackEvent['type'];
