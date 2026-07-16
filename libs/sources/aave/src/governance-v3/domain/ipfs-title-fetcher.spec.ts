import { describe, expect, it, vi } from 'vitest';
import { AaveIpfsTitleFetcher } from './ipfs-title-fetcher';

/** A gateway response carrying `body` — the fetcher reads the document as text, never `.json()`. */
function respond(body: string) {
  return { ok: true, text: vi.fn().mockResolvedValue(body) };
}

describe('AaveIpfsTitleFetcher', () => {
  it('resolves title and description from IPFS metadata JSON', async () => {
    const fetcher = new AaveIpfsTitleFetcher({
      fetchImpl: vi
        .fn()
        .mockResolvedValue(
          respond(JSON.stringify({ title: '## Aave Title', description: 'Body' })),
        ),
      gatewayUrl: 'https://ipfs.io/ipfs/',
      timeoutMs: 100,
    });

    await expect(fetcher.fetchTitleDescription('12'.repeat(32))).resolves.toEqual({
      kind: 'resolved',
      title: 'Aave Title',
      description: 'Body',
    });
  });

  it('resolves title and description from markdown with YAML front matter', async () => {
    // The shape Aave has published since ~2022 and for every governance v3 proposal. Served as
    // text/plain, so `.json()` rejects it outright on the leading `---`.
    const document = [
      '---',
      'title: Add 1INCH to Aave v2 market',
      'status: Proposed',
      'shortDescription: Add 1INCH as collateral on the Aave V2 market',
      'discussions: https://governance.aave.com/t/arc-add-1inch-as-collateral/8056',
      '---',
      '',
      '## Simple Summary',
      '',
      'Proposal body.',
    ].join('\n');
    const fetcher = new AaveIpfsTitleFetcher({
      fetchImpl: vi.fn().mockResolvedValue(respond(document)),
    });

    // Title comes from front matter, NOT the body's first heading — that is a section name.
    await expect(fetcher.fetchTitleDescription('12'.repeat(32))).resolves.toEqual({
      kind: 'resolved',
      title: 'Add 1INCH to Aave v2 market',
      description: '## Simple Summary\n\nProposal body.',
    });
  });

  it('uses shortDescription as the front-matter title when title is absent', async () => {
    const document = ['---', 'shortDescription: Onboard rETH', '---', '', 'Body text.'].join('\n');
    const fetcher = new AaveIpfsTitleFetcher({
      fetchImpl: vi.fn().mockResolvedValue(respond(document)),
    });

    await expect(fetcher.fetchTitleDescription('12'.repeat(32))).resolves.toEqual({
      kind: 'resolved',
      title: 'Onboard rETH',
      description: 'Body text.',
    });
  });

  it('falls back to no_title when the document has no usable title', async () => {
    const fetcher = new AaveIpfsTitleFetcher({
      fetchImpl: vi.fn().mockResolvedValue(respond(JSON.stringify({ description: '\n  \n' }))),
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
      fetchImpl: vi
        .fn()
        .mockResolvedValue(
          respond(JSON.stringify({ title: null, shortDescription: '# Short title' })),
        ),
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
      .mockResolvedValueOnce(
        respond(JSON.stringify({ title: 'Fallback title', description: 'Fallback body' })),
      );
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

  it('returns schema_mismatch for a document that is neither JSON nor front matter', async () => {
    const fetcher = new AaveIpfsTitleFetcher({
      fetchImpl: vi.fn().mockResolvedValue(respond('bad body')),
    });

    await expect(fetcher.fetchTitleDescription('12'.repeat(32))).resolves.toEqual({
      kind: 'error',
      reason: 'schema_mismatch',
    });
  });

  it('returns body_read_failed when the response body cannot be read', async () => {
    const fetcher = new AaveIpfsTitleFetcher({
      fetchImpl: vi
        .fn()
        .mockResolvedValue({ ok: true, text: vi.fn().mockRejectedValue(new Error('aborted')) }),
    });

    const result = await fetcher.fetchTitleDescription('12'.repeat(32));
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.reason).toContain('body_read_failed:Error: aborted');
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
