import { describe, expect, it, vi } from 'vitest';
import { AaveIpfsTitleFetcher } from './ipfs-title-fetcher';

describe('AaveIpfsTitleFetcher', () => {
  it('resolves title and description from IPFS metadata JSON', async () => {
    const fetcher = new AaveIpfsTitleFetcher({
      fetchImpl: vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          title: '## Aave Title',
          description: 'Body',
        }),
      }),
      gatewayUrl: 'https://ipfs.io/ipfs/',
      timeoutMs: 100,
    });

    await expect(fetcher.fetchTitleDescription('12'.repeat(32))).resolves.toEqual({
      kind: 'resolved',
      title: 'Aave Title',
      description: 'Body',
    });
  });

  it('falls back to no_title when the document has no usable title', async () => {
    const fetcher = new AaveIpfsTitleFetcher({
      fetchImpl: vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ description: '\n  \n' }),
      }),
    });

    await expect(fetcher.fetchTitleDescription('12'.repeat(32))).resolves.toEqual({
      kind: 'no_title',
    });
  });

  it('returns error on non-2xx responses', async () => {
    const fetcher = new AaveIpfsTitleFetcher({
      fetchImpl: vi.fn().mockResolvedValue({ ok: false, status: 504 }),
    });

    await expect(fetcher.fetchTitleDescription('12'.repeat(32))).resolves.toEqual({
      kind: 'error',
      reason: 'http_504',
    });
  });

  it('returns error for invalid digests before fetching', async () => {
    const fetchImpl = vi.fn();
    const fetcher = new AaveIpfsTitleFetcher({ fetchImpl });

    await expect(fetcher.fetchTitleDescription('bad')).resolves.toEqual({
      kind: 'error',
      reason: 'invalid_digest_hex',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('falls back to shortDescription when description is absent', async () => {
    const fetcher = new AaveIpfsTitleFetcher({
      fetchImpl: vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          title: null,
          shortDescription: '# Short title',
        }),
      }),
    });

    await expect(fetcher.fetchTitleDescription('12'.repeat(32))).resolves.toEqual({
      kind: 'resolved',
      title: 'Short title',
      description: '# Short title',
    });
  });

  it('retries with the fallback gateway before returning an error', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 504 })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          title: 'Fallback title',
          description: 'Fallback body',
        }),
      });
    const fetcher = new AaveIpfsTitleFetcher({
      fetchImpl,
      gatewayUrl: 'https://primary.example/ipfs/',
      fallbackGatewayUrl: 'https://fallback.example/ipfs/',
    });

    await expect(fetcher.fetchTitleDescription('12'.repeat(32))).resolves.toEqual({
      kind: 'resolved',
      title: 'Fallback title',
      description: 'Fallback body',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('returns schema_mismatch for non-object JSON bodies', async () => {
    const fetcher = new AaveIpfsTitleFetcher({
      fetchImpl: vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue('bad body'),
      }),
    });

    await expect(fetcher.fetchTitleDescription('12'.repeat(32))).resolves.toEqual({
      kind: 'error',
      reason: 'schema_mismatch',
    });
  });

  it('returns json_parse_failed when the gateway body is not valid JSON', async () => {
    const fetcher = new AaveIpfsTitleFetcher({
      fetchImpl: vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockRejectedValue(new Error('bad json')),
      }),
    });

    const result = await fetcher.fetchTitleDescription('12'.repeat(32));
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.reason).toContain('json_parse_failed:Error: bad json');
    }
  });

  it('returns the thrown fetch error when all gateways fail before a response', async () => {
    const fetcher = new AaveIpfsTitleFetcher({
      fetchImpl: vi.fn().mockRejectedValue(new Error('timeout')),
    });

    const result = await fetcher.fetchTitleDescription('12'.repeat(32));
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.reason).toContain('Error: timeout');
    }
  });
});
