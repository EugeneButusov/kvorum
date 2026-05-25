import { z } from 'zod';
import { BUCKET_GRAIN_ENUM } from './bucket';

export const PASS_RATE_QUERY_SCHEMA = z
  .object({
    bucket: BUCKET_GRAIN_ENUM.optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    proposal_type: z.string().min(1).optional(),
  })
  .refine((v) => !(v.from && v.to && v.from > v.to), {
    message: 'from must be before or equal to to',
    path: ['from'],
  });

export type PassRateQuery = z.infer<typeof PASS_RATE_QUERY_SCHEMA>;
