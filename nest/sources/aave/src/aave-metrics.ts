import { defineCounter } from '@libs/observability';

export const aaveMetrics = {
  ipfsTitleFetch: defineCounter({
    name: 'aave_ipfs_title_fetch',
    description: 'Aave IPFS title fetch outcomes during proposal derivation',
  }),
  voteDerivation: defineCounter({
    name: 'aave_vote_derivation',
    description: 'Aave vote derivation outcomes during voting-machine projection',
  }),
} as const;
