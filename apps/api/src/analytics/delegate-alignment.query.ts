import { z } from 'zod';

export const DELEGATE_ALIGNMENT_QUERY_SCHEMA = z
  .object({
    delegate: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    limit: z.coerce.number().int().min(1).max(50).optional(),
    cursor: z.string().optional(),
    sort: z.string().optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .refine((v) => !(v.from && v.to && v.from > v.to), {
    message: 'from must be before or equal to to',
    path: ['from'],
  });
