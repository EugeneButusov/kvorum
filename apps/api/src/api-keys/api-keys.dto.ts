import { z } from 'zod';
import { ZodSchema } from '../http/zod-validation.pipe';

export const createKeySchema = z.object({
  label: z.string().trim().min(1).max(64).optional(),
});

@ZodSchema(createKeySchema)
export class CreateKeyDto {
  declare label?: string;
}
