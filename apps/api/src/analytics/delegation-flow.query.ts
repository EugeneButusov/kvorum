import { z } from 'zod';

export const DELEGATION_FLOW_QUERY_SCHEMA = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    min_voting_power: z.string().regex(/^\d+$/).optional(),
  })
  .refine((v) => !(v.from && v.to && v.from > v.to), {
    message: 'from must be before or equal to to',
    path: ['from'],
  });
