import { defineCounter, defineGauge, defineHistogram } from '@libs/observability';

export const calldataDecodeMetrics = {
  outcomes: defineCounter({
    name: 'derivation_calldata_decode_outcomes',
    description: 'Decode-pipeline outcomes by source and outcome',
  }),
  abiDecodeSuccessRate: defineGauge({
    name: 'derivation_abi_decode_success_rate',
    description:
      'Fraction of calldata decode attempts that fully decoded in the last worker tick (decoded / total)',
  }),
  tickDurationSeconds: defineHistogram({
    name: 'derivation_calldata_decode_tick_duration_seconds',
    description: 'Wall-clock duration of one decode worker tick',
    buckets: [0.001, 0.01, 0.1, 0.5, 1, 5, 30],
  }),
  proxyResolutions: defineCounter({
    name: 'derivation_calldata_proxy_resolutions',
    description: 'Proxy resolutions during decoding by outcome',
  }),
  collisionDecoded: defineCounter({
    name: 'derivation_calldata_collision_decoded',
    description:
      'Decode attempts where the bundled-library selector bucket had >1 candidate (R8). Audit signal.',
  }),
  etherscanCalls: defineCounter({
    name: 'derivation_calldata_etherscan_calls',
    description: 'Etherscan enrichment calls by outcome (hit/miss/error/skipped)',
  }),
} as const;
