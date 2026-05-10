import { describe, expect, it } from 'vitest';
import { parseChainConfigFromEnv } from './config.js';
import { ChainConfigError } from '../errors/chain-config.error.js';

const validConfig = {
  chains: [
    {
      chainId: 1,
      name: 'ethereum',
      reorgHorizon: 12,
      providers: [{ name: 'alchemy', url: 'http://localhost:8545', kind: 'http', priority: 1 }],
    },
  ],
};

function env(config: unknown): NodeJS.ProcessEnv {
  return { CHAIN_CONFIG: JSON.stringify(config) };
}

describe('parseChainConfigFromEnv', () => {
  it('parses a valid config', () => {
    const [chain] = parseChainConfigFromEnv(env(validConfig));
    expect(chain.chainId).toBe(1);
    expect(chain.providers).toHaveLength(1);
    expect(chain.providers[0]?.name).toBe('alchemy');
  });

  it('throws when CHAIN_CONFIG is not set', () => {
    expect(() => parseChainConfigFromEnv({})).toThrow(ChainConfigError);
    expect(() => parseChainConfigFromEnv({})).toThrow('not set');
  });

  it('throws on invalid JSON', () => {
    expect(() => parseChainConfigFromEnv({ CHAIN_CONFIG: '{bad json' })).toThrow(ChainConfigError);
    expect(() => parseChainConfigFromEnv({ CHAIN_CONFIG: '{bad json' })).toThrow('not valid JSON');
  });

  it('throws when a required field is missing', () => {
    const bad = { chains: [{ chainId: 1, name: 'x', providers: [] }] };
    expect(() => parseChainConfigFromEnv(env(bad))).toThrow(ChainConfigError);
    expect(() => parseChainConfigFromEnv(env(bad))).toThrow('validation failed');
  });

  it('throws when providers array is empty', () => {
    const bad = { chains: [{ ...validConfig.chains[0], providers: [] }] };
    expect(() => parseChainConfigFromEnv(env(bad))).toThrow(ChainConfigError);
  });

  it('throws when a field has the wrong type', () => {
    const bad = { chains: [{ ...validConfig.chains[0], chainId: 'not-a-number' }] };
    expect(() => parseChainConfigFromEnv(env(bad))).toThrow(ChainConfigError);
  });

  it('throws when overallTimeoutMs is non-positive', () => {
    const bad = { chains: [{ ...validConfig.chains[0], overallTimeoutMs: 0 }] };
    expect(() => parseChainConfigFromEnv(env(bad))).toThrow(ChainConfigError);
  });

  it('includes the offending JSON path in the error message', () => {
    const bad = { chains: [{ ...validConfig.chains[0], chainId: 'bad' }] };
    try {
      parseChainConfigFromEnv(env(bad));
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ChainConfigError);
      expect((e as ChainConfigError).message).toMatch(/chains\.\d+\.chainId/);
    }
  });

  it('parses optional fields', () => {
    const config = {
      chains: [
        {
          ...validConfig.chains[0],
          lagThresholdBlocks: 5,
          overallTimeoutMs: 8000,
          providers: [
            { ...validConfig.chains[0].providers[0], timeoutMs: 3000, dailyQuota: 100000 },
          ],
        },
      ],
    };
    const [chain] = parseChainConfigFromEnv(env(config));
    expect(chain.lagThresholdBlocks).toBe(5);
    expect(chain.providers[0]?.dailyQuota).toBe(100000);
  });
});
