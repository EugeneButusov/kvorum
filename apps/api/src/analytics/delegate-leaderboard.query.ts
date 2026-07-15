import { z } from 'zod';

export const DELEGATE_LEADERBOARD_QUERY_SCHEMA = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
