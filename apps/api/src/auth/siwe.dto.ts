import { z } from 'zod';
import { ZodSchema } from '../http/zod-validation.pipe';

export const siweVerifySchema = z.object({
  // The raw EIP-4361 message string the wallet signed, and the signature over it.
  message: z.string().min(1),
  signature: z.string().min(1),
  // Optional recovery email captured at sign-in (SPEC §6.14) — not verification-gated for SIWE.
  email: z.string().email().optional(),
});

@ZodSchema(siweVerifySchema)
export class SiweVerifyDto {
  message!: string;
  signature!: string;
  email?: string;
}
