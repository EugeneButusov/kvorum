import { z } from 'zod';

// One `discourse_forum` source per DAO; the seeded source_config is `{ host, categories }`.
// `host` is the forum origin (e.g. `research.lido.fi`); `categories` are Discourse category slugs
// (e.g. `proposals`, `governance`) whose numeric ids the crawler resolves via /categories.json.
export const ForumConfigSchema = z.object({
  host: z.string().min(1),
  categories: z.array(z.string().min(1)).min(1),
});

export type ForumConfig = z.infer<typeof ForumConfigSchema>;

export function parseForumConfig(raw: unknown): ForumConfig {
  return ForumConfigSchema.parse(raw);
}
