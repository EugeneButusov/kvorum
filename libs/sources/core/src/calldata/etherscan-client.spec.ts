import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EtherscanClient } from './etherscan-client';

const CHAIN = '0x1';
const ADDR = '0x0000000000000000000000000000000000000001';
const BASE_URL = 'https://api.etherscan.io/v2/api';

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
    baseUrl: BASE_URL,
    supportedChainIds: [CHAIN],
    sleep: async () => {}, // no real timers in tests
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

  it('returns null and logs rate_limited (not unavailable) after exhausting retries on HTTP 429', async () => {
    const { client, logger } = makeClient({ maxRateLimitRetries: 2 });
    globalThis.fetch = mockFetch(429, '', false);

    const result = await client.fetchAbi(CHAIN, ADDR);

    expect(result).toBeNull();
    expect(logger.info).toHaveBeenCalledWith('etherscan_rate_limited', expect.anything());
    expect(logger.info).not.toHaveBeenCalledWith('etherscan_abi_unavailable', expect.anything());
  });

  it('treats an HTTP-200 "Max rate limit reached" body as retryable, not unavailable', async () => {
    const { client, logger } = makeClient({ maxRateLimitRetries: 1 });
    globalThis.fetch = mockFetch(200, {
      status: '0',
      message: 'NOTOK',
      result: 'Max rate limit reached',
    });

    const result = await client.fetchAbi(CHAIN, ADDR);

    expect(result).toBeNull();
    expect(logger.info).toHaveBeenCalledWith('etherscan_rate_limited', expect.anything());
    expect(logger.info).not.toHaveBeenCalledWith('etherscan_abi_unavailable', expect.anything());
  });

  it('retries a rate-limited request and returns the ABI once it succeeds', async () => {
    const { client } = makeClient({ maxRateLimitRetries: 3 });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: '0', result: 'Max rate limit reached' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: '1', message: 'OK', result: JSON.stringify(SAMPLE_ABI) }),
      });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await client.fetchAbi(CHAIN, ADDR);

    expect(result).toEqual(SAMPLE_ABI);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('fetchImplementation returns the lowercased implementation for a recognised proxy', async () => {
    const impl = '0xCFC1fa6b7cA982176529899d99AF6473AD80DF4F';
    const { client } = makeClient();
    globalThis.fetch = mockFetch(200, {
      status: '1',
      message: 'OK',
      result: [{ Proxy: '1', Implementation: impl, ContractName: 'X' }],
    });

    const result = await client.fetchImplementation(CHAIN, ADDR);

    expect(result).toBe(impl.toLowerCase());
  });

  it('fetchImplementation returns null when the contract is not a proxy', async () => {
    const { client } = makeClient();
    globalThis.fetch = mockFetch(200, {
      status: '1',
      message: 'OK',
      result: [{ Proxy: '0', Implementation: '', ContractName: 'X' }],
    });

    const result = await client.fetchImplementation(CHAIN, ADDR);

    expect(result).toBeNull();
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

  it('returns null and logs info when chainId is not in the supported set', async () => {
    const { client, logger } = makeClient({ supportedChainIds: [] });

    const result = await client.fetchAbi('0x999', ADDR);

    expect(result).toBeNull();
    expect(logger.info).toHaveBeenCalledWith('etherscan_chain_not_configured', expect.anything());
  });

  it('targets the V2 unified endpoint with the decimal chainid param', async () => {
    const { client } = makeClient({ supportedChainIds: ['0xa86a'] });
    const fetchMock = mockFetch(200, {
      status: '1',
      message: 'OK',
      result: JSON.stringify(SAMPLE_ABI),
    });
    globalThis.fetch = fetchMock;

    await client.fetchAbi('0xa86a', ADDR);

    const calledUrl = new URL((fetchMock as ReturnType<typeof vi.fn>).mock.calls[0][0] as string);
    expect(`${calledUrl.origin}${calledUrl.pathname}`).toBe(BASE_URL);
    expect(calledUrl.searchParams.get('chainid')).toBe('43114');
    expect(calledUrl.searchParams.get('module')).toBe('contract');
    expect(calledUrl.searchParams.get('action')).toBe('getabi');
    expect(calledUrl.searchParams.get('address')).toBe(ADDR);
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
