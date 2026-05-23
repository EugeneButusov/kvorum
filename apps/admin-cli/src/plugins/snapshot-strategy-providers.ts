import type { ChainContextRegistry } from '@libs/chain';
import { pgDb } from '@libs/db';
import type { VotingPowerStrategy } from '@libs/domain';

export interface SnapshotStrategyProviderInput {
  registry: ChainContextRegistry;
  chainId: string;
}

export interface SnapshotStrategyProvider {
  make(input: SnapshotStrategyProviderInput): Promise<Map<string, VotingPowerStrategy>>;
}

export function buildSnapshotStrategyProviders(): readonly SnapshotStrategyProvider[] {
  return [buildCompoundSnapshotStrategyProvider()];
}

function buildCompoundSnapshotStrategyProvider(): SnapshotStrategyProvider {
  return {
    make: async (input) => {
      const { CompoundCompTokenVotingPowerStrategy } = await import('@sources/compound');
      const strategy = new CompoundCompTokenVotingPowerStrategy(
        pgDb,
        input.registry,
        input.chainId,
      );
      return new Map<string, VotingPowerStrategy>([
        ['compound_governor_alpha', strategy],
        ['compound_governor_bravo', strategy],
        ['compound_governor_oz', strategy],
      ]);
    },
  };
}
