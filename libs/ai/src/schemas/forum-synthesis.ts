import { z } from 'zod';

/** Registry schema-label; must equal the `schema:` frontmatter field of the forum template. */
export const FORUM_SYNTHESIS_SCHEMA_NAME = 'ForumSynthesisSchema';

// SPEC §5.7 — the structured synthesis of a Discourse thread linked to a proposal.
// NOTE: the array `.max()` bounds are enforced by Zod on the model's output, but `toStrippedJsonSchema`
// removes size keywords (maxItems/maxLength) from the JSON schema the model sees. So the prompt MUST
// restate these caps in prose; otherwise the model can exceed them and trip a schema-violation → DLQ.
export const ForumSynthesisSchema = z.object({
  arguments_for: z
    .array(
      z.object({
        summary: z.string(),
        supporting_participants: z.array(z.string()).max(5),
      }),
    )
    .max(7),
  arguments_against: z
    .array(
      z.object({
        summary: z.string(),
        supporting_participants: z.array(z.string()).max(5),
      }),
    )
    .max(7),
  unresolved_concerns: z
    .array(
      z.object({
        summary: z.string(),
        raised_by: z.array(z.string()).max(3),
      }),
    )
    .max(5),
  notable_participants: z
    .array(
      z.object({
        handle: z.string(),
        role_summary: z.string(),
      }),
    )
    .max(10),
  sentiment: z.enum(['favorable', 'mixed', 'unfavorable', 'contentious']),
  thread_health: z.enum(['constructive', 'mixed', 'unproductive']),
});

export type ForumSynthesis = z.infer<typeof ForumSynthesisSchema>;

// --- Skip marker (SPEC §5.7 / KNOWN-016) --------------------------------------------------------
// A non-English thread is not synthesized; instead the worker persists a sentinel `ai_output` row
// whose `output` jsonb carries this marker (no LLM call, zero cost). The #444 API reads it to return
// a `null` synthesis with the `_meta.skipped_reason`. Stored in the same `output` column a real
// synthesis would occupy, keyed on the same `sha256(raw_content)`.
export type ForumSkipReason = 'non_english';

export interface ForumSkipMarker {
  _meta: { skipped_reason: ForumSkipReason };
}

export function forumSkipMarker(reason: ForumSkipReason): ForumSkipMarker {
  return { _meta: { skipped_reason: reason } };
}

/** True when a stored `ai_output.output` is a skip marker rather than a real `ForumSynthesis`. */
export function isForumSkip(output: unknown): output is ForumSkipMarker {
  if (typeof output !== 'object' || output === null) return false;
  const meta = (output as Record<string, unknown>)['_meta'];
  if (typeof meta !== 'object' || meta === null) return false;
  return typeof (meta as Record<string, unknown>)['skipped_reason'] === 'string';
}
