const TRANSIENT_SQLSTATES = new Set([
  '08000',
  '08001',
  '08003',
  '08006',
  '08007', // connection-level
  '57P01',
  '57P02',
  '57P03', // admin/shutdown
  '40001',
  '40P01', // serialization
  '53300', // too_many_connections
  '08004', // server_rejected_establishment
]);

const TRANSIENT_NODE_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND']);

export function isTransientDbError(err: unknown): boolean {
  if (err == null || typeof err !== 'object') return false;
  const e = err as Record<string, unknown>;
  const code = typeof e['code'] === 'string' ? e['code'] : '';
  return TRANSIENT_SQLSTATES.has(code) || TRANSIENT_NODE_CODES.has(code);
}
