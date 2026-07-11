import { z } from 'zod';
import { ZodSchema } from '../http/zod-validation.pipe';

export const siweVerifySchema = z.object({
  // The raw EIP-4361 message string the wallet signed, and the signature over it.
  message: z.string().min(1),
  signature: z.string().min(1),
  // Optional recovery email captured at sign-in (SPEC §6.14) — not verification-gated for SIWE.
  email: z.string().email().optional(),
});

// The class is never instantiated — the ZodValidationPipe returns the parsed plain object, and the
// class exists only as the pipe's metatype + decorator target. So the fields are `declare` (ambient
// type only, zero runtime emit) rather than `!`, which would assert a runtime assignment that never
// happens.
@ZodSchema(siweVerifySchema)
export class SiweVerifyDto {
  declare message: string;
  declare signature: string;
  declare email?: string;
}
