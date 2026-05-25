import autocannon from 'autocannon';

type Target = {
  name: string;
  path: string;
  threshold: { metric: 'p95' | 'p99'; maxMs: number };
};

const targets: Target[] = [
  {
    name: 'proposal-pass-rate',
    path: '/v1/daos/compound/analytics/proposal-pass-rate',
    threshold: { metric: 'p95', maxMs: 500 },
  },
  {
    name: 'concentration',
    path: '/v1/daos/compound/analytics/concentration',
    threshold: { metric: 'p99', maxMs: 5000 },
  },
  {
    name: 'delegation-flow',
    path: '/v1/daos/compound/analytics/delegation-flow',
    threshold: { metric: 'p99', maxMs: 5000 },
  },
  {
    name: 'delegate-alignment',
    path: '/v1/daos/compound/analytics/delegate-alignment?delegate=0x0000000000000000000000000000000000000000',
    threshold: { metric: 'p99', maxMs: 5000 },
  },
  {
    name: 'cross-dao',
    path: '/v1/actors/0x0000000000000000000000000000000000000000/analytics/cross-dao',
    threshold: { metric: 'p99', maxMs: 5000 },
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
