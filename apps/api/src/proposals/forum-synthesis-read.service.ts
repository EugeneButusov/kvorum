import { Injectable } from '@nestjs/common';
import {
  AiOutputRepository,
  FORUM_SYNTHESIZER_TEMPLATE,
  forumSynthesisInputHash,
  type AiOutput,
} from '@libs/ai';

// Content-addressed lookup of a stored forum-thread synthesis (SPEC §5.7). `ai_output` has no thread
// FK — it is keyed by (feature, prompt_version, input_hash) where input_hash = sha256(raw_content), so
// the caller passes the same `raw_content` the worker synthesized. Derived from the template so the
// lookup tracks its feature/version. A non-English thread is stored as a skip-marker row (the caller
// detects it via `isForumSkip`); `null` means no synthesis yet (unprocessed / budget-capped).
const FEATURE = FORUM_SYNTHESIZER_TEMPLATE.feature ?? FORUM_SYNTHESIZER_TEMPLATE.name;
const VERSION = FORUM_SYNTHESIZER_TEMPLATE.version;

@Injectable()
export class ForumSynthesisReadService {
  constructor(private readonly outputs: AiOutputRepository) {}

  async findForContent(rawContent: string): Promise<AiOutput | null> {
    const inputHash = forumSynthesisInputHash(rawContent);
    const row = await this.outputs.find(FEATURE, VERSION, inputHash);
    return row ?? null;
  }
}
