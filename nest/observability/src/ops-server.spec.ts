import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpsServer as OpsServerType } from './ops-server';

// @libs/observability (imported transitively by OpsServer) throws at module load
// unless OTEL_SERVICE_NAME/NAMESPACE are set — so set them, reset modules, then
// dynamically import. Mirrors libs/observability/src/observability.spec.ts.
let OpsServer: typeof OpsServerType;
let ops: OpsServerType;
let previousPort: string | undefined;

// Reaches the private http.Server so the test can bind an ephemeral port (OPS_PORT=0)
// and issue real requests without racing a fixed port across parallel runs.
function portOf(server: OpsServerType): number {
  const http = (server as unknown as { server?: { address(): AddressInfo | string | null } })
    .server;
  const addr = http?.address();
  if (!addr || typeof addr === 'string') throw new Error('server not listening on a TCP port');
  return addr.port;
}

beforeEach(async () => {
  vi.resetModules();
  process.env['OTEL_SERVICE_NAMESPACE'] = 'test';
  process.env['OTEL_SERVICE_NAME'] = 'ops-test';
  previousPort = process.env['OPS_PORT'];
  process.env['OPS_PORT'] = '0'; // ephemeral port
  ({ OpsServer } = await import('./ops-server'));
  ops = new OpsServer();
  ops.onApplicationBootstrap();
  await new Promise((resolve) => setTimeout(resolve, 50)); // let listen() bind
});

afterEach(() => {
  ops.onApplicationShutdown();
  if (previousPort === undefined) delete process.env['OPS_PORT'];
  else process.env['OPS_PORT'] = previousPort;
});

describe('OpsServer', () => {
  it('serves 200 on /health with a JSON status body', async () => {
    const res = await fetch(`http://127.0.0.1:${portOf(ops)}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('serves 200 on /metrics', async () => {
    const res = await fetch(`http://127.0.0.1:${portOf(ops)}/metrics`);
    expect(res.status).toBe(200);
  });

  it('serves 404 on unknown routes', async () => {
    const res = await fetch(`http://127.0.0.1:${portOf(ops)}/nope`);
    expect(res.status).toBe(404);
  });
});
