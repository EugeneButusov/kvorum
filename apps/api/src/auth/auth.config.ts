import { z } from 'zod';
import { decodePepper, type PepperSet } from '@libs/auth';

const schema = z.object({
  HMAC_PEPPER_CURRENT: z.string().min(1).transform(decodePepper),
  HMAC_PEPPER_PREVIOUS: z
    .string()
    .min(1)
    .optional()
    .transform((value) => {
      if (value === undefined) {
        return undefined;
      }

      return decodePepper(value);
    }),
});

export function parseAuthConfigFromEnv(env: NodeJS.ProcessEnv): PepperSet {
  const parsed = schema.parse(env);
  return {
    current: parsed.HMAC_PEPPER_CURRENT,
    previous: parsed.HMAC_PEPPER_PREVIOUS,
  };
}
