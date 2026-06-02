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
});
