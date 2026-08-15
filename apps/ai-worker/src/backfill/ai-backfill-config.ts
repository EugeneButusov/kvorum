import { Injectable } from '@nestjs/common';
import { readPositiveInt } from '@libs/utils';
import type { AiFeature } from '../queue/ai-queue-names';

const FEATURE_FLAG_ENV: Record<AiFeature, string> = {
  proposal_summarizer: 'AI_BACKFILL_SUMMARIZE_ENABLED',
  mismatch_detector: 'AI_BACKFILL_MISMATCH_ENABLED',
  forum_synthesizer: 'AI_BACKFILL_FORUM_ENABLED',
  embedding: 'AI_BACKFILL_EMBED_ENABLED',
};

/**
 * Full-history backfill controls (M5-7.1), read from env ON EVERY CALL (never cached), default OFF —
 * mirroring AiTriggerConfig. A feature backfills only when BOTH the master `AI_BACKFILL_ENABLED` and its
 * per-feature flag are `'true'`, so the operator can stage runs (e.g. the cheap 0.5× batch features
 * first, the 1× mismatch run separately). `AI_BACKFILL_DAOS` scopes the run to specific DAO slugs
 * (empty ⇒ all DAOs); the backfill service is otherwise inert.
 */
@Injectable()
export class AiBackfillConfig {
  isEnabled(): boolean {
    return process.env['AI_BACKFILL_ENABLED'] === 'true';
  }

  isFeatureEnabled(feature: AiFeature): boolean {
    return this.isEnabled() && process.env[FEATURE_FLAG_ENV[feature]] === 'true';
  }

  daoSlugs(): string[] {
    return (process.env['AI_BACKFILL_DAOS'] ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  pageSize(): number {
    return readPositiveInt('AI_BACKFILL_PAGE_SIZE', 100);
  }
}
