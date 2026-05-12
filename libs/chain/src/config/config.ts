import { z } from 'zod';
import { ChainConfigError } from '../errors/chain-config.error.js';

/**
 * Normalises a chain identifier to its canonical string form:
 * - EVM hex strings (0x…) → lowercase, no leading zeros: '0x1', '0x89'
 * - Non-hex strings (e.g. 'solana-mainnet') → trimmed as-is
 */
export function normalizeChainId(raw: string): string {
  const trimmed = raw.trim();
  if (/^0x/i.test(trimmed)) {
    return '0x' + BigInt(trimmed).toString(16);
  }
  return trimmed;
}

const ProviderConfigSchema = z.object({
  name: z.string().min(1),
  url: z.string().url(),
  kind: z.enum(['http', 'ws']),
  priority: z.number().int().positive(),
  timeoutMs: z.number().int().positive().optional(),
  dailyQuota: z.number().int().positive().optional(),
});

const ChainConfigSchema = z.object({
  chainId: z.string().min(1).transform(normalizeChainId),
  name: z.string().min(1),
  reorgHorizon: z.number().int().positive(),
  lagThresholdBlocks: z.number().int().positive().optional(),
  overallTimeoutMs: z.number().int().positive().optional(),
  headPollIntervalMs: z.number().int().positive().optional(),
  sweepIntervalMs: z.number().int().positive().optional(),
  eventPollIntervalMs: z.number().int().positive().optional(),
  providers: z
    .array(ProviderConfigSchema)
    .min(1)
    .refine((xs) => new Set(xs.map((x) => x.name)).size === xs.length, {
      message: 'provider names must be unique within a chain',
    }),
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
