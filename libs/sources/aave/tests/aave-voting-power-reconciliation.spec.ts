import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ChainContextRegistry } from '@libs/chain';
import {
  AaveGovernancePowerReader,
  A_AAVE_TOKEN_ADDRESS,
  AAVE_TOKEN_ADDRESS,
  aggregateSubmittedVotingPower,
  aggregateVotingPower,
  STK_AAVE_TOKEN_ADDRESS,
} from '@sources/aave';
import { decodeSubmitVoteCalldata, decodeSubmitVoteProofs } from '@sources/aave';

interface SubmittedProofFixture {
  underlyingAsset: string;
  slot: string;
}

interface ReconciliationSample {
  txHash: string;
  voter: string;
  submitMethod: string;
  calldata: string;
  submittedProofs: SubmittedProofFixture[];
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

  it('matches submitted assets decoded from pinned calldata', () => {
    const fixture = loadFixture();

    for (const sample of fixture.samples) {
      expect(decodeSubmitVoteCalldata(sample.calldata)).toEqual(sample.submittedAssets);
    }
  });

  it('matches submitted proof slots decoded from pinned calldata', () => {
    const fixture = loadFixture();

    for (const sample of fixture.samples) {
      expect(decodeSubmitVoteProofs(sample.calldata)).toEqual(
        sample.submittedProofs.map((proof) => ({
          underlyingAsset: proof.underlyingAsset,
          slot: BigInt(proof.slot),
        })),
      );
    }
  });

  it('pins submitted-asset totals separately from the full three-token sum', () => {
    const fixture = loadFixture();

    for (const sample of fixture.samples) {
      const reads = {
        aave: BigInt(sample.reads.aave),
        stkAave: BigInt(sample.reads.stkAave),
        aAave: BigInt(sample.reads.aAave),
      };

      expect(aggregateSubmittedVotingPower(reads, sample.submittedAssets)).toBeLessThanOrEqual(
        aggregateVotingPower(reads),
      );
    }
  });

  it('computed three-token power is at least the protocol-reported power for all sampled voters', () => {
    const fixture = loadFixture();

    for (const sample of fixture.samples) {
      const reads = {
        aave: BigInt(sample.reads.aave),
        stkAave: BigInt(sample.reads.stkAave),
        aAave: BigInt(sample.reads.aAave),
      };

      // reported = VoteEmitted.votingPower — the protocol's proof-validated power for the
      // submitted storage-slot proofs (own balance only, no received delegations).
      // computed = Σ getPowerCurrent@block over all three tokens — includes received
      // delegations, so computed >= reported always.  Equality holds only when the
      // voter has no incoming delegations (voter 3 in this fixture).
      expect(aggregateVotingPower(reads)).toBeGreaterThanOrEqual(BigInt(sample.reported));

      // The submitted-asset subset power also bounds reported from above for the same
      // reason: even a subset of getPowerCurrent values includes delegation-to-voter
      // while the proof reconstructs from the voter's own storage slot.
      expect(aggregateSubmittedVotingPower(reads, sample.submittedAssets)).toBeGreaterThanOrEqual(
        BigInt(sample.reported),
      );
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
});
