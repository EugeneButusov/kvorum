import { readPositiveNumber } from '@libs/utils';
import { FEATURE_QUEUE } from '../queue/ai-queue-names';
import type { AiFeature } from '../queue/ai-queue-names';

/** Canonical runtime list of AI features, derived from FEATURE_QUEUE so it can't drift. */
export const AI_FEATURES = Object.keys(FEATURE_QUEUE) as AiFeature[];

const CAP_ENV: Record<AiFeature, string> = {
  proposal_summarizer: 'AI_CAP_SUMMARIZE_USD',
  mismatch_detector: 'AI_CAP_MISMATCH_USD',
  forum_synthesizer: 'AI_CAP_FORUM_SYNTHESIS_USD',
  embedding: 'AI_CAP_EMBED_USD',
};

// SPEC §5.3 default monthly caps (USD).
const DEFAULT_CAP_USD: Record<AiFeature, number> = {
  proposal_summarizer: 5,
  mismatch_detector: 20,
  forum_synthesizer: 15,
  embedding: 1,
};

/** Per-feature monthly cap (USD), read from env on each call; falls back to the SPEC default. */
export function readCap(feature: AiFeature): number {
  return readPositiveNumber(CAP_ENV[feature], DEFAULT_CAP_USD[feature]);
}

/** Start of the current calendar month in UTC (00:00:00 on the 1st). */
export function startOfCurrentMonthUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
