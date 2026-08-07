import { z } from 'zod';
import type { SimilarProposalFilters } from '@libs/ai';
import { badRequestProblem } from '../http/problem-exception';

/** Validation for `GET …/similar` query params. `dao`/`type`/time are optional narrowing filters;
 *  `limit` is coerced + capped (default 10 applied by the controller). Mirrors the analytics
 *  `delegate-alignment` query idiom. */
export const SIMILAR_QUERY_SCHEMA = z
  .object({
    dao: z.string().optional(),
    type: z.string().optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    limit: z.coerce.number().int().min(1).max(20).optional(),
  })
  .refine((v) => !(v.from && v.to && v.from > v.to), {
    message: 'from must be before or equal to to',
    path: ['from'],
  });

/** Validate + normalize the query into repo filters (default `limit` 10). Throws a 400 problem on
 *  invalid input, mirroring the analytics controllers' zod → problem conversion. */
export function parseSimilarQuery(raw: unknown): SimilarProposalFilters {
  const parsed = SIMILAR_QUERY_SCHEMA.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue && issue.path.length > 0 ? issue.path.map(String).join('.') : 'query';
    throw badRequestProblem('validation', [{ field, message: issue?.message ?? 'Invalid query' }]);
  }
  const d = parsed.data;
  return { dao: d.dao, type: d.type, from: d.from, to: d.to, limit: d.limit ?? 10 };
}
