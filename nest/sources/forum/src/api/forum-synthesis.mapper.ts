import { isForumSkip, type AiOutput, type ForumSynthesis } from '@libs/ai';
import { isoSeconds } from '@libs/db';
import {
  ForumSynthesisDto,
  ForumSynthesisMetaDto,
  ForumSynthesisResponseDto,
} from './forum-synthesis.dto';

/** Map a stored forum-synthesis `ai_output` row into the response envelope (SPEC §5.7). A
 *  non-English skip-marker row yields `data: null` + `_meta.skipped_reason`; a real synthesis yields
 *  the ForumSynthesis payload + a provenance `_meta` (`model` distinguishes Haiku/Sonnet).
 *  Envelope-level `_meta` so both cases share one shape. Shared by the proposal `…/ai/forum-synthesis`
 *  route and the thread-keyed `…/forum/{external_id}/ai/synthesis` route. */
export function toForumSynthesisResponse(output: AiOutput): ForumSynthesisResponseDto {
  if (isForumSkip(output.output)) {
    return {
      data: null,
      _meta: Object.assign(new ForumSynthesisMetaDto(), {
        ai_generated: false,
        skipped_reason: output.output._meta.skipped_reason,
      }),
    };
  }
  return {
    data: Object.assign(new ForumSynthesisDto(), output.output as ForumSynthesis),
    _meta: Object.assign(new ForumSynthesisMetaDto(), {
      ai_generated: true,
      model: output.model,
      prompt_version: output.prompt_version,
      input_hash: output.input_hash,
      generated_at: isoSeconds(output.generated_at),
    }),
  };
}
