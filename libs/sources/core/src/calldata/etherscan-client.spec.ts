import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EtherscanClient } from './etherscan-client';

const CHAIN = '1';
const ADDR = '0x0000000000000000000000000000000000000001';
const BASE_URL = 'https://api.etherscan.io';

const SAMPLE_ABI = [
  {
    type: 'function',
    name: 'transfer',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
];

function makeClient(overrides: Partial<ConstructorParameters<typeof EtherscanClient>[0]> = {}) {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const client = new EtherscanClient({
    apiKey: 'test-key',
    baseUrlByChainId: { [CHAIN]: BASE_URL },
    logger,
    ...overrides,
  });
  return { client, logger };
}

function mockFetch(status: number, body: unknown, okOverride?: boolean): typeof fetch {
  const ok = okOverride ?? (status >= 200 && status < 300);
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => body,
  } as Response);
}

describe('EtherscanClient', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('returns ABI array on successful response', async () => {
    const { client, logger } = makeClient();
    globalThis.fetch = mockFetch(200, {
      status: '1',
      message: 'OK',
      result: JSON.stringify(SAMPLE_ABI),
    });

    const result = await client.fetchAbi(CHAIN, ADDR);

    expect(result).toEqual(SAMPLE_ABI);
    expect(logger.info).toHaveBeenCalledWith(
      'etherscan_abi_fetched',
      expect.objectContaining({ chainId: CHAIN, address: ADDR }),
    );
  });

  it('includes apiKey in request URL when configured', async () => {
    const { client } = makeClient({ apiKey: 'my-api-key' });
    const fetchMock = mockFetch(200, {
      status: '1',
      message: 'OK',
      result: JSON.stringify(SAMPLE_ABI),
    });
    globalThis.fetch = fetchMock;

    await client.fetchAbi(CHAIN, ADDR);

    const calledUrl = (fetchMock as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain('apikey=my-api-key');
  });

  it('returns null and logs info on HTTP 404', async () => {
    const { client, logger } = makeClient();
    globalThis.fetch = mockFetch(404, '', false);

    const result = await client.fetchAbi(CHAIN, ADDR);

    expect(result).toBeNull();
    expect(logger.info).toHaveBeenCalledWith('etherscan_not_found', expect.anything());
  });

  it('returns null and logs info on HTTP 429 (rate limit)', async () => {
    const { client, logger } = makeClient();
    globalThis.fetch = mockFetch(429, '', false);

    const result = await client.fetchAbi(CHAIN, ADDR);

    expect(result).toBeNull();
    expect(logger.info).toHaveBeenCalledWith('etherscan_rate_limited', expect.anything());
  });

  it('returns null and logs warn when response body is not valid JSON', async () => {
    const { client, logger } = makeClient();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token');
      },
    } as unknown as Response);

    const result = await client.fetchAbi(CHAIN, ADDR);

    expect(result).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith('etherscan_json_parse_failed', expect.anything());
  });

  it('returns null and logs warn when ABI result field is invalid JSON', async () => {
    const { client, logger } = makeClient();
    globalThis.fetch = mockFetch(200, { status: '1', message: 'OK', result: 'not valid json {[' });

    const result = await client.fetchAbi(CHAIN, ADDR);

    expect(result).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith('etherscan_abi_parse_failed', expect.anything());
  });

  it('returns null and logs info when Etherscan reports contract not verified (status 0)', async () => {
    const { client, logger } = makeClient();
    globalThis.fetch = mockFetch(200, {
      status: '0',
      message: 'NOTOK',
      result: 'Contract source code not verified',
    });

    const result = await client.fetchAbi(CHAIN, ADDR);

    expect(result).toBeNull();
    expect(logger.info).toHaveBeenCalledWith('etherscan_abi_unavailable', expect.anything());
  });

  it('returns null and logs info when chainId is not in the configured map', async () => {
    const { client, logger } = makeClient({ baseUrlByChainId: {} });

    const result = await client.fetchAbi('999', ADDR);

    expect(result).toBeNull();
    expect(logger.info).toHaveBeenCalledWith('etherscan_chain_not_configured', expect.anything());
  });

  it('returns null and logs info on network-level fetch error', async () => {
    const { client, logger } = makeClient();
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed'));

    const result = await client.fetchAbi(CHAIN, ADDR);

    expect(result).toBeNull();
    expect(logger.info).toHaveBeenCalledWith('etherscan_network_error', expect.anything());
  });

  it('returns null and logs info on generic non-404/429 HTTP error (e.g. 500)', async () => {
    const { client, logger } = makeClient();
    globalThis.fetch = mockFetch(500, '', false);

    const result = await client.fetchAbi(CHAIN, ADDR);

    expect(result).toBeNull();
    expect(logger.info).toHaveBeenCalledWith('etherscan_http_error', expect.anything());
  });

  it('returns null and logs warn when parsed ABI result is not an array', async () => {
    const { client, logger } = makeClient();
    globalThis.fetch = mockFetch(200, {
      status: '1',
      message: 'OK',
      result: JSON.stringify({ not: 'an array' }),
    });

    const result = await client.fetchAbi(CHAIN, ADDR);

    expect(result).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith('etherscan_abi_not_array', expect.anything());
  });
});
