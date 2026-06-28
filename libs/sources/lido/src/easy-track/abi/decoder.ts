import type { LogDescription } from 'ethers';
import type { LogEvent } from '@libs/chain';
import { DecodeError } from '@sources/core';
import { EASY_TRACK_INTERFACE, EASY_TRACK_TOPICS } from './events';
import type { EasyTrackEvent } from '../domain/types';

const lowercaseAddress = (value: unknown): string => (value as string).toLowerCase();
const toDecimalString = (value: unknown): string => (value as bigint).toString();

type Builder = (parsed: LogDescription) => EasyTrackEvent;

// topic0 → builder. A single contract (one Interface), so dispatch could be by name, but topic0
// dispatch matches the sibling Lido decoders and stays robust if a future event name collides.
const DISPATCH: Record<string, Builder> = {
  [EASY_TRACK_TOPICS.MotionCreated]: (parsed) => ({
    type: 'MotionCreated',
    payload: {
      motionId: toDecimalString(parsed.args['_motionId']),
      creator: lowercaseAddress(parsed.args['_creator']),
      evmScriptFactory: lowercaseAddress(parsed.args['_evmScriptFactory']),
      evmScriptCallData: parsed.args['_evmScriptCallData'] as string,
      evmScript: parsed.args['_evmScript'] as string,
    },
  }),
  [EASY_TRACK_TOPICS.MotionObjected]: (parsed) => ({
    type: 'MotionObjected',
    payload: {
      motionId: toDecimalString(parsed.args['_motionId']),
      objector: lowercaseAddress(parsed.args['_objector']),
      weight: toDecimalString(parsed.args['_weight']),
      newObjectionsAmount: toDecimalString(parsed.args['_newObjectionsAmount']),
      newObjectionsAmountPct: toDecimalString(parsed.args['_newObjectionsAmountPct']),
    },
  }),
  [EASY_TRACK_TOPICS.MotionRejected]: (parsed) => ({
    type: 'MotionRejected',
    payload: { motionId: toDecimalString(parsed.args['_motionId']) },
  }),
  [EASY_TRACK_TOPICS.MotionCanceled]: (parsed) => ({
    type: 'MotionCanceled',
    payload: { motionId: toDecimalString(parsed.args['_motionId']) },
  }),
  [EASY_TRACK_TOPICS.MotionEnacted]: (parsed) => ({
    type: 'MotionEnacted',
    payload: { motionId: toDecimalString(parsed.args['_motionId']) },
  }),
  [EASY_TRACK_TOPICS.MotionDurationChanged]: (parsed) => ({
    type: 'MotionDurationChanged',
    payload: { motionDuration: toDecimalString(parsed.args['_motionDuration']) },
  }),
  [EASY_TRACK_TOPICS.ObjectionsThresholdChanged]: (parsed) => ({
    type: 'ObjectionsThresholdChanged',
    payload: { newThreshold: toDecimalString(parsed.args['_newThreshold']) },
  }),
  [EASY_TRACK_TOPICS.MotionsCountLimitChanged]: (parsed) => ({
    type: 'MotionsCountLimitChanged',
    payload: { newMotionsCountLimit: toDecimalString(parsed.args['_newMotionsCountLimit']) },
  }),
  [EASY_TRACK_TOPICS.EVMScriptExecutorChanged]: (parsed) => ({
    type: 'EVMScriptExecutorChanged',
    payload: { evmScriptExecutor: lowercaseAddress(parsed.args['_evmScriptExecutor']) },
  }),
};

export function decodeEasyTrackLog(log: LogEvent, _sourceType: string): EasyTrackEvent {
  const logRef = { txHash: log.txHash, logIndex: log.logIndex, blockHash: log.blockHash };
  const topic0 = log.topics[0]?.toLowerCase();
  const build = topic0 ? DISPATCH[topic0] : undefined;
  if (!build) {
    throw new DecodeError('unknown_topic', undefined, logRef);
  }

  let parsed: LogDescription | null;
  try {
    parsed = EASY_TRACK_INTERFACE.parseLog({ topics: log.topics, data: log.data });
  } catch (err) {
    throw new DecodeError('parse_failed', err, logRef);
  }
  if (!parsed) {
    throw new DecodeError('parse_failed', undefined, logRef);
  }
  return build(parsed);
}
