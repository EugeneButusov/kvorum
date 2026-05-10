import { z } from 'zod';
import { ChainConfigError } from './chain-config.error.js';

const ProviderConfigSchema = z.object({
  name: z.string().min(1),
  url: z.string().url(),
  kind: z.enum(['http', 'ws']),
  priority: z.number().int().positive(),
  timeoutMs: z.number().int().positive().optional(),
  dailyQuota: z.number().int().positive().optional(),
});

const ChainConfigSchema = z.object({
  chainId: z.number().int().positive(),
  name: z.string().min(1),
  reorgHorizon: z.number().int().positive(),
  lagThresholdBlocks: z.number().int().positive().optional(),
  overallTimeoutMs: z.number().int().positive().optional(),
  providers: z.array(ProviderConfigSchema).min(1),
});

const EnvSchema = z.object({
  chains: z.array(ChainConfigSchema).min(1),
});

export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
export type ChainConfig = z.infer<typeof ChainConfigSchema>;

export function parseChainConfigFromEnv(env: NodeJS.ProcessEnv): ChainConfig[] {
  const raw = env['CHAIN_CONFIG'];
  if (!raw) {
    throw new ChainConfigError('CHAIN_CONFIG env var is not set');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ChainConfigError('CHAIN_CONFIG is not valid JSON');
  }

  const result = EnvSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new ChainConfigError(`CHAIN_CONFIG validation failed: ${issues}`);
  }

  return result.data.chains;
}
