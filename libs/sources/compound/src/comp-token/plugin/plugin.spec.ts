import { getAddress } from 'ethers';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { silentLogger } from '@libs/chain';
import type { DlqRepository } from '@libs/db';
import type { SourceContext } from '@sources/core';
import {
  COMP_TOKEN_SUPPORTED_CHAIN_IDS,
  createCompTokenPlugin,
  type CompTokenSourceConfig,
} from './plugin';
import { COMPOUND_COMP_TOKEN_TOPICS } from '../abi/events';
import { COMP_TOKEN_ADDRESS } from '../constants';
import type { CompTokenArchiveWriter } from '../ingestion/archive-writer';
import * as ingesterListener from '../ingestion/ingester-listener';

const CTX: SourceContext = {
  daoSourceId: '00000000-0000-0000-0000-000000000001',
  sourceType: 'compound_comp_token',
  chainId: '1',
  sourceLabel: 'compound_comp_token',
};

const J2_EIP55_COMP_TOKEN = getAddress(COMP_TOKEN_ADDRESS);
const UPPERCASE_COMP_TOKEN = COMP_TOKEN_ADDRESS.toUpperCase().replace('0X', '0x');

const mockArchiveWriter = {} as CompTokenArchiveWriter;
const mockDlqRepo = { insert: vi.fn() } as unknown as DlqRepository;

function makePlugin() {
  return createCompTokenPlugin({
    archiveWriter: mockArchiveWriter,
    dlqRepo: mockDlqRepo,
    logger: silentLogger,
  });
}

describe('createCompTokenPlugin', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('P1 parseConfig accepts J2 literal EIP-55 address and lowercase address', () => {
    const plugin = makePlugin();
    expect(
      plugin.parseConfig({
        token_address: J2_EIP55_COMP_TOKEN,
      }),
    ).toEqual({ token_address: J2_EIP55_COMP_TOKEN });
    expect(plugin.parseConfig({ token_address: COMP_TOKEN_ADDRESS })).toEqual({
      token_address: COMP_TOKEN_ADDRESS,
    });
  });

  it('P2 parseConfig rejects malformed address', () => {
    expect(() => makePlugin().parseConfig({ token_address: 'not-an-address' })).toThrow();
  });

  it('P3 parseConfig rejects missing token_address', () => {
    expect(() => makePlugin().parseConfig({})).toThrow();
  });

  it('P4 supportedChainIds is only mainnet hex id', () => {
    expect(makePlugin().supportedChainIds).toEqual(COMP_TOKEN_SUPPORTED_CHAIN_IDS);
  });

  it('P5 sourceType is compound_comp_token', () => {
    expect(makePlugin().sourceType).toBe('compound_comp_token');
  });

  it('P6 buildBackfillRuntime lowercases filter.address', () => {
    const plugin = makePlugin();
    const cfg = plugin.parseConfig({
      token_address: UPPERCASE_COMP_TOKEN,
    });
    const runtime = plugin.buildBackfillRuntime(CTX, cfg);
    expect(runtime.filter.address).toBe(COMP_TOKEN_ADDRESS);
  });

  it('P7 buildBackfillRuntime filter.topics uses DelegateChanged OR DelegateVotesChanged', () => {
    const plugin = makePlugin();
    const runtime = plugin.buildBackfillRuntime(CTX, { token_address: COMP_TOKEN_ADDRESS });
    expect(runtime.filter.topics).toEqual([
      [COMPOUND_COMP_TOKEN_TOPICS.DelegateChanged, COMPOUND_COMP_TOKEN_TOPICS.DelegateVotesChanged],
    ]);
  });

  it('P8 buildIngestSpec returns evm-event-poller with listener', () => {
    const plugin = makePlugin();
    const spec = plugin.buildIngestSpec(CTX, { token_address: COMP_TOKEN_ADDRESS });
    expect(spec.kind).toBe('evm-event-poller');
    expect(typeof spec.listener).toBe('function');
  });

  it('P9 buildBackfillRuntime listenerFactory passes classifier and throw mode', () => {
    const spy = vi.spyOn(ingesterListener, 'makeCompTokenIngesterListener');
    const plugin = makePlugin();
    const runtime = plugin.buildBackfillRuntime(CTX, { token_address: COMP_TOKEN_ADDRESS });
    const classifier = vi.fn(() => 'confirmed' as const);

    runtime.listenerFactory(classifier);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(
      {
        archiveWriter: mockArchiveWriter,
        context: { ...CTX, confirmationClassifier: classifier },
        logger: silentLogger,
        dlqRepo: mockDlqRepo,
      },
      { onWriteFailure: 'throw' },
    );
  });

  it('P10 buildIngestSpec uses pending classifier and throw mode', () => {
    const spy = vi.spyOn(ingesterListener, 'makeCompTokenIngesterListener');
    const plugin = makePlugin();

    plugin.buildIngestSpec(CTX, { token_address: COMP_TOKEN_ADDRESS });

    expect(spy).toHaveBeenCalledTimes(1);
    const args = spy.mock.calls[0];
    expect(args[1]).toEqual({ onWriteFailure: 'throw' });
    expect(args[0].context.confirmationClassifier?.(1n)).toBe('pending');
  });

  it('P11 parseConfig strips unknown fields', () => {
    const plugin = makePlugin();
    const parsed = plugin.parseConfig({
      token_address: COMP_TOKEN_ADDRESS,
      extra: 'foo',
    } as CompTokenSourceConfig & { extra: string });
    expect(parsed).toEqual({ token_address: COMP_TOKEN_ADDRESS });
    expect((parsed as Record<string, unknown>).extra).toBeUndefined();
  });

  it('P12 buildIngestSpec lowercases filter.address', () => {
    const plugin = makePlugin();
    const spec = plugin.buildIngestSpec(CTX, {
      token_address: UPPERCASE_COMP_TOKEN,
    });
    expect(spec.filter.address).toBe(COMP_TOKEN_ADDRESS);
  });

  it('P13 parseConfig rejects non-COMP valid address with token_address refinement path', () => {
    expect(() => makePlugin().parseConfig({ token_address: `0x${'a'.repeat(40)}` })).toThrowError(
      /token_address must equal canonical COMP token/i,
    );
  });

  it('P14 buildBackfillRuntime returns stable runtime shape', () => {
    const plugin = makePlugin();
    const runtime = plugin.buildBackfillRuntime(CTX, { token_address: COMP_TOKEN_ADDRESS });

    expect(Object.keys(runtime).sort()).toEqual(['filter', 'listenerFactory']);
    expect(runtime.listenerFactory).toHaveLength(1);
    expect(runtime.filter).toEqual(
      expect.objectContaining({
        address: COMP_TOKEN_ADDRESS,
        topics: expect.any(Array),
      }),
    );
  });
});
