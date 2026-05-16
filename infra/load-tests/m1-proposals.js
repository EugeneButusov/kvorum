/*
M1 load test (regression smoke):
- Warmup primes cache and query plans.
- Measure 200-path and 304-path separately.
- Gate only on p95<500ms for 200-path.
*/

const autocannon = require('autocannon');

const API_URL = process.env.API_URL || 'http://127.0.0.1:3001';
const BEARER = process.env.API_BEARER || `Bearer ${'kv_live_'}${'a'.repeat(32)}`;
const CONNECTIONS = Number(process.env.LOADTEST_CONNECTIONS || 50);
const DURATION_SECONDS = Number(process.env.LOADTEST_DURATION_SECONDS || 30);
const WARMUP_SECONDS = Number(process.env.LOADTEST_WARMUP_SECONDS || 10);
const THRESHOLD_MS = Number(process.env.LOADTEST_P95_THRESHOLD_MS || 500);

function runAutocannon(opts) {
  return new Promise((resolve, reject) => {
    autocannon(opts, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

function printLatency(label, result) {
  const latency = result.latency || {};
  const p50 = Number(latency.p50 || 0);
  const p95 = Number(latency.p95 || 0);
  const p99 = Number(latency.p99 || 0);
  console.log(`${label}: p50=${p50.toFixed(2)}ms p95=${p95.toFixed(2)}ms p99=${p99.toFixed(2)}ms`);
  return { p50, p95, p99 };
}

function assertNoTransportErrors(label, result) {
  const errors = Number(result.errors || 0);
  const timeouts = Number(result.timeouts || 0);
  if (errors > 0 || timeouts > 0) {
    throw new Error(`${label} had transport issues (errors=${errors}, timeouts=${timeouts})`);
  }
}

async function warmup() {
  const targets = [
    '/v1/daos/compound/proposals?limit=50',
    '/v1/proposals?dao=compound&limit=50',
    '/v1/daos/compound/proposals/compound_governor/10010',
  ];

  for (const path of targets) {
    await runAutocannon({
      url: `${API_URL}${path}`,
      method: 'GET',
      headers: { Authorization: BEARER },
      connections: Math.min(10, CONNECTIONS),
      duration: WARMUP_SECONDS,
      pipelining: 1,
    });
  }
}

async function measure200Path(path) {
  const result = await runAutocannon({
    url: `${API_URL}${path}`,
    method: 'GET',
    headers: { Authorization: BEARER },
    connections: CONNECTIONS,
    duration: DURATION_SECONDS,
    pipelining: 1,
  });
  assertNoTransportErrors(`200-path ${path}`, result);
  const stats = printLatency(`200-path ${path}`, result);
  return stats.p95;
}

async function measure304Path(path) {
  const prime = await fetch(`${API_URL}${path}`, {
    headers: { Authorization: BEARER },
  });
  const etag = prime.headers.get('etag');
  if (!etag) {
    throw new Error(`No ETag returned for ${path}`);
  }

  const result = await runAutocannon({
    url: `${API_URL}${path}`,
    method: 'GET',
    headers: {
      Authorization: BEARER,
      'If-None-Match': etag,
    },
    connections: CONNECTIONS,
    duration: DURATION_SECONDS,
    pipelining: 1,
  });
  assertNoTransportErrors(`304-path ${path}`, result);
  return printLatency(`304-path ${path}`, result);
}

async function main() {
  console.log(`Load target: ${API_URL}`);
  console.log(`Connections: ${CONNECTIONS}, duration: ${DURATION_SECONDS}s`);

  await warmup();

  const p95s = [];
  p95s.push(await measure200Path('/v1/daos/compound/proposals?limit=50'));
  p95s.push(await measure200Path('/v1/proposals?dao=compound&limit=50'));
  p95s.push(await measure200Path('/v1/daos/compound/proposals/compound_governor/10010'));

  await measure304Path('/v1/daos/compound/proposals?limit=50');

  const worstP95 = Math.max(...p95s);
  console.log(`200-path worst p95: ${worstP95.toFixed(2)}ms (threshold ${THRESHOLD_MS}ms)`);

  if (worstP95 >= THRESHOLD_MS) {
    throw new Error(`Load-test failed: 200-path p95 ${worstP95.toFixed(2)}ms >= ${THRESHOLD_MS}ms`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
