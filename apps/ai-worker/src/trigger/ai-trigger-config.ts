import { Injectable } from '@nestjs/common';
import type { AiFeature } from '../queue/ai-queue-names';

const FLAG_ENV: Record<AiFeature, string> = {
  proposal_summarizer: 'AI_TRIGGER_SUMMARIZE_ENABLED',
  mismatch_detector: 'AI_TRIGGER_MISMATCH_ENABLED',
  forum_synthesizer: 'AI_TRIGGER_FORUM_SYNTHESIS_ENABLED',
  embedding: 'AI_TRIGGER_EMBED_ENABLED',
};

/** Per-feature trigger enable flags, read from env ON EVERY CALL (never cached), default OFF.
 *  Doubles as the disable surface #434's budget cap and admin-cli AI-feature controls reuse. */
@Injectable()
export class AiTriggerConfig {
  isEnabled(feature: AiFeature): boolean {
    return process.env[FLAG_ENV[feature]] === 'true';
  }
}
