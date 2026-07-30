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
