// AiFeature values are the canonical feature_name (aligned with #431 template names and
// #432 ai_output.feature_name), NOT the queue names. FEATURE_QUEUE maps each to its transport.
export type AiFeature =
  | 'proposal_summarizer'
  | 'mismatch_detector'
  | 'forum_synthesizer'
  | 'embedding';

export interface AiJob {
  feature: AiFeature;
  entityRef: string; // '<entityType>:<id>', e.g. 'proposal:<uuid>'
  inputHash?: string; // optional — populated by M5-2 handlers, absent at trigger time
}

export const AI_SUMMARIZE_QUEUE = 'ai_summarize';
export const AI_SUMMARIZE_DLQ_QUEUE = 'ai_summarize_dlq';
export const AI_MISMATCH_QUEUE = 'ai_mismatch';
export const AI_MISMATCH_DLQ_QUEUE = 'ai_mismatch_dlq';
export const AI_FORUM_SYNTHESIS_QUEUE = 'ai_forum_synthesis';
export const AI_FORUM_SYNTHESIS_DLQ_QUEUE = 'ai_forum_synthesis_dlq';
export const AI_EMBED_QUEUE = 'ai_embed';
export const AI_EMBED_DLQ_QUEUE = 'ai_embed_dlq';

export const FEATURE_QUEUE: Record<AiFeature, { main: string; dlq: string }> = {
  proposal_summarizer: { main: AI_SUMMARIZE_QUEUE, dlq: AI_SUMMARIZE_DLQ_QUEUE },
  mismatch_detector: { main: AI_MISMATCH_QUEUE, dlq: AI_MISMATCH_DLQ_QUEUE },
  forum_synthesizer: { main: AI_FORUM_SYNTHESIS_QUEUE, dlq: AI_FORUM_SYNTHESIS_DLQ_QUEUE },
  embedding: { main: AI_EMBED_QUEUE, dlq: AI_EMBED_DLQ_QUEUE },
};
