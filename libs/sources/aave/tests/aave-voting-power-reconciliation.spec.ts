import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ChainContextRegistry, parseChainConfigFromEnv } from '@libs/chain';
import {
  AaveGovernancePowerReader,
  A_AAVE_TOKEN_ADDRESS,
  AAVE_TOKEN_ADDRESS,
  aggregateVotingPower,
  STK_AAVE_TOKEN_ADDRESS,
} from '@sources/aave';

interface ReconciliationSample {
  txHash: string;
  voter: string;
  submitMethod: string;
  submittedAssets: string[];
  reported: string;
  reads: {
    aave: string;
    stkAave: string;
    aAave: string;
  };
  computed: string;
}

interface ReconciliationFixture {
  proposalId: string;
  snapshotBlockNumber: string;
  snapshotBlockHash: string;
  tokenAddresses: {
    aave: string;
    stkAave: string;
    aAave: string;
  };
  samples: ReconciliationSample[];
}

function loadFixture(): ReconciliationFixture {
  const path = join(
    __dirname,
    'fixtures',
    'voting-power',
    'proposal-489-avalanche-reconciliation.json',
  );
  return JSON.parse(readFileSync(path, 'utf8')) as ReconciliationFixture;
}

const RUN_LIVE = process.env['AAVE_RECONCILIATION_LIVE'] === '1';
const itLive = RUN_LIVE ? it : it.skip;

describe('Aave voting power reconciliation fixture', () => {
  it('pins proposal 489 sample reads and plain-sum totals', async () => {
    const fixture = loadFixture();

    expect(fixture.tokenAddresses).toEqual({
      aave: AAVE_TOKEN_ADDRESS,
      stkAave: STK_AAVE_TOKEN_ADDRESS,
      aAave: A_AAVE_TOKEN_ADDRESS,
    });

    for (const sample of fixture.samples) {
      const computed = aggregateVotingPower({
        aave: BigInt(sample.reads.aave),
        stkAave: BigInt(sample.reads.stkAave),
        aAave: BigInt(sample.reads.aAave),
      });

      expect(computed).toBe(BigInt(sample.computed));
    }
  });

  it('replays the fixture through AaveGovernancePowerReader', async () => {
    const fixture = loadFixture();
    const powerByKey = new Map<string, bigint>();

    for (const sample of fixture.samples) {
      powerByKey.set(`${AAVE_TOKEN_ADDRESS}:${sample.voter}`, BigInt(sample.reads.aave));
      powerByKey.set(`${STK_AAVE_TOKEN_ADDRESS}:${sample.voter}`, BigInt(sample.reads.stkAave));
      powerByKey.set(`${A_AAVE_TOKEN_ADDRESS}:${sample.voter}`, BigInt(sample.reads.aAave));
    }

    const fakeRegistry = {
      peek: () => ({
        client: {
          send: async (_method: string, params: unknown[]) => {
            const [{ to, data }] = params as [{ to: string; data: string }, string];
            const address = data.slice(34, 74);
            const voter = `0x${address}`.toLowerCase();
            const key = `${String(to).toLowerCase()}:${voter}`;
            const power = powerByKey.get(key);
            if (power == null) {
              throw new Error(`missing fixture power for ${key}`);
            }

            return `0x${power.toString(16).padStart(64, '0')}`;
          },
        },
      }),
    } as unknown as ChainContextRegistry;

    const reader = new AaveGovernancePowerReader(fakeRegistry);
    const snapshotBlock = BigInt(fixture.snapshotBlockNumber);

    for (const sample of fixture.samples) {
      await expect(reader.read(sample.voter, snapshotBlock)).resolves.toEqual({
        aave: BigInt(sample.reads.aave),
        stkAave: BigInt(sample.reads.stkAave),
        aAave: BigInt(sample.reads.aAave),
      });
    }
  });

  itLive('matches the pinned fixture against a live Ethereum archive provider', async () => {
    const fixture = loadFixture();
    const chainCfg = parseChainConfigFromEnv(process.env).find((cfg) => cfg.chainId === '0x1');
    if (chainCfg == null) {
      throw new Error('CHAIN_CONFIG must include Ethereum mainnet (0x1)');
    }

    const registry = new ChainContextRegistry();
    try {
      await registry.getOrCreate(chainCfg);
      const reader = new AaveGovernancePowerReader(registry);
      const snapshotBlock = BigInt(fixture.snapshotBlockNumber);

      for (const sample of fixture.samples) {
        await expect(reader.read(sample.voter, snapshotBlock)).resolves.toEqual({
          aave: BigInt(sample.reads.aave),
          stkAave: BigInt(sample.reads.stkAave),
          aAave: BigInt(sample.reads.aAave),
        });
      }
    } finally {
      await registry.drainAll();
    }
  });
});
