import autocannon from 'autocannon';

type Target = {
  name: string;
  path: string;
  threshold: { metric: 'p95' | 'p99'; maxMs: number };
};

// Compound targets — established in M2/O3
// Aave + cross-DAO targets added in M3/X3 (D3). Authoritative p95/p99 gated in Y3 post-backfill;
// X3 establishes the harness + smoke targets over a representative local dataset.
const targets: Target[] = [
  {
    name: 'compound-proposal-pass-rate',
    path: '/v1/daos/compound/analytics/proposal-pass-rate',
    threshold: { metric: 'p95', maxMs: 500 },
  },
  {
    name: 'compound-concentration',
    path: '/v1/daos/compound/analytics/concentration',
    threshold: { metric: 'p99', maxMs: 5000 },
  },
  {
    name: 'compound-delegation-flow',
    path: '/v1/daos/compound/analytics/delegation-flow',
    threshold: { metric: 'p99', maxMs: 5000 },
  },
  {
    name: 'compound-delegate-alignment',
    path: '/v1/daos/compound/analytics/delegate-alignment?delegate=0x0000000000000000000000000000000000000000',
    threshold: { metric: 'p99', maxMs: 5000 },
  },
  // Aave targets — concentration returns 204 (no power-bearing delegation, ADR-061 rule 8)
  {
    name: 'aave-proposal-pass-rate',
    path: '/v1/daos/aave/analytics/proposal-pass-rate',
    threshold: { metric: 'p95', maxMs: 500 },
  },
  {
    name: 'aave-concentration',
    path: '/v1/daos/aave/analytics/concentration',
    threshold: { metric: 'p99', maxMs: 5000 },
  },
  {
    name: 'aave-delegation-flow',
    path: '/v1/daos/aave/analytics/delegation-flow',
    threshold: { metric: 'p99', maxMs: 5000 },
  },
  // Cross-DAO targets
  {
    name: 'cross-dao-actor',
    path: '/v1/actors/0x0000000000000000000000000000000000000000/analytics/cross-dao',
    threshold: { metric: 'p99', maxMs: 5000 },
  },
  {
    name: 'cross-dao-proposals',
    path: '/v1/proposals?dao=compound,aave',
    threshold: { metric: 'p95', maxMs: 1000 },
  },
];

async function runOne(baseUrl: string, apiKey: string, target: Target): Promise<void> {
  const result = await autocannon({
    url: `${baseUrl}${target.path}`,
    connections: 20,
    duration: 20,
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  const got = target.threshold.metric === 'p95' ? result.latency.p95 : result.latency.p99;
  const ok = got <= target.threshold.maxMs;
  const status = ok ? 'OK' : 'FAIL';

  console.log(
    `${status} ${target.name}: ${target.threshold.metric}=${got}ms (limit ${target.threshold.maxMs}ms)`,
  );
  if (!ok) {
    throw new Error(`${target.name} exceeded latency budget`);
  }
}

async function main() {
  const baseUrl = process.env['API_BASE_URL'] ?? 'http://localhost:3001';
  const apiKey = process.env['API_KEY'];
  if (!apiKey) {
    throw new Error('API_KEY is required');
  }

  for (const target of targets) {
    await runOne(baseUrl, apiKey, target);
  }
}

void main();
