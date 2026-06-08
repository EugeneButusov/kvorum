import { defineCounter, defineGauge } from '@libs/observability';

export const aaveMetrics = {
  ipfsTitleFetch: defineCounter({
    name: 'aave_ipfs_title_fetch',
    description: 'Aave IPFS title fetch outcomes during proposal derivation',
  }),
  voteDerivation: defineCounter({
    name: 'aave_vote_derivation',
    description: 'Aave vote derivation outcomes during voting-machine projection',
  }),
  payloadDerivation: defineCounter({
    name: 'aave_payload_derivation',
    description: 'Aave payload derivation outcomes during payload-controller projection',
  }),
  stitchPendingSeconds: defineGauge({
    name: 'stitch_pending_seconds',
    description:
      'Age of the oldest Aave vote held awaiting its not-yet-derived proposal, by voting chain and event type',
  }),
  payloadStitchPendingSeconds: defineGauge({
    name: 'stitch_payload_pending_seconds',
    description:
      'Age of the oldest Aave payload held awaiting its declared payload row, by target chain and event type',
  }),
} as const;
