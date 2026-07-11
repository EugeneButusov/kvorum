import { z } from 'zod';

export interface SiweConfig {
  // The domain (authority: host[:port]) the EIP-4361 message must bind to. Security-critical — it
  // is verified against the signed message, NOT taken from the request Host header (spoofable).
  domain: string;
}

const schema = z.object({
  SIWE_DOMAIN: z.string().min(1).default('localhost:3000'),
});

export function parseSiweConfigFromEnv(env: NodeJS.ProcessEnv): SiweConfig {
  const parsed = schema.parse(env);
  return { domain: parsed.SIWE_DOMAIN };
}
