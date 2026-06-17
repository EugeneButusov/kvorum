import { getAddress } from 'ethers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { silentLogger } from '@libs/chain';
import type { DlqRepository } from '@libs/db';
import type { SourceContext } from '@sources/core';
import {
  AAVE_TOKEN_SUPPORTED_CHAIN_IDS,
  createAaveTokenPlugin,
  type AaveTokenConfig,
} from './plugin';
import { AAVE_TOKEN_TOPICS } from '../abi/events';
import { AAVE_TOKEN_ADDRESS } from '../constants';
import type { AaveTokenArchiveWriter } from '../ingestion/archive-writer';

const CTX: SourceContext = {
  daoSourceId: '00000000-0000-0000-0000-000000000001',
  sourceType: 'aave_token',
  chainId: '1',
  sourceLabel: 'aave_token',
};

const EIP55_AAVE_TOKEN = getAddress(AAVE_TOKEN_ADDRESS);
const UPPERCASE_AAVE_TOKEN = AAVE_TOKEN_ADDRESS.toUpperCase().replace('0X', '0x');

const mockArchiveWriter = {} as AaveTokenArchiveWriter;
const mockDlqRepo = { insert: vi.fn() } as unknown as DlqRepository;

function makePlugin() {
  return createAaveTokenPlugin({
    archiveWriter: mockArchiveWriter,
    dlqRepo: mockDlqRepo,
    logger: silentLogger,
  });
}

describe('createAaveTokenPlugin', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('parseConfig accepts EIP-55 and lowercase AAVE token addresses', () => {
    const plugin = makePlugin();
    expect(plugin.parseConfig({ token_address: EIP55_AAVE_TOKEN })).toEqual({
      token_address: EIP55_AAVE_TOKEN,
    });
    expect(plugin.parseConfig({ token_address: AAVE_TOKEN_ADDRESS })).toEqual({
      token_address: AAVE_TOKEN_ADDRESS,
    });
  });

  it('parseConfig rejects a malformed address', () => {
    expect(() => makePlugin().parseConfig({ token_address: 'not-an-address' })).toThrow();
  });

  it('parseConfig rejects a missing token_address', () => {
    expect(() => makePlugin().parseConfig({})).toThrow();
  });

  it('parseConfig rejects a valid non-AAVE address with the refinement path', () => {
    expect(() => makePlugin().parseConfig({ token_address: `0x${'a'.repeat(40)}` })).toThrowError(
      /token_address must equal canonical AAVE token/i,
    );
  });

  it('parseConfig strips unknown fields', () => {
    const parsed = makePlugin().parseConfig({
      token_address: AAVE_TOKEN_ADDRESS,
      extra: 'foo',
    } as AaveTokenConfig & { extra: string });
    expect(parsed).toEqual({ token_address: AAVE_TOKEN_ADDRESS });
  });

  it('supportedChainIds is mainnet only', () => {
    expect(makePlugin().supportedChainIds).toEqual(AAVE_TOKEN_SUPPORTED_CHAIN_IDS);
    expect(AAVE_TOKEN_SUPPORTED_CHAIN_IDS).toEqual(['0x1']);
  });

  it('sourceType is aave_token', () => {
    expect(makePlugin().sourceType).toBe('aave_token');
  });

  it('buildIngestSpec returns an evm-event-poller filtered on DelegateChanged, lowercased', () => {
    const plugin = makePlugin();
    const spec = plugin.buildIngestSpec(CTX, { token_address: UPPERCASE_AAVE_TOKEN });
    expect(spec.kind).toBe('evm-event-poller');
    expect(spec.listener).toBeUndefined();
    expect(spec.filter.address).toBe(AAVE_TOKEN_ADDRESS);
    expect(spec.filter.topics).toEqual([[AAVE_TOKEN_TOPICS.DelegateChanged]]);
  });

  it('buildBackfillRuntime lowercases filter.address and filters DelegateChanged', () => {
    const plugin = makePlugin();
    const cfg = plugin.parseConfig({ token_address: UPPERCASE_AAVE_TOKEN });
    const runtime = plugin.buildBackfillRuntime(CTX, cfg);
    expect(runtime.filter.address).toBe(AAVE_TOKEN_ADDRESS);
    expect(runtime.filter.topics).toEqual([[AAVE_TOKEN_TOPICS.DelegateChanged]]);
    expect(Object.keys(runtime).sort()).toEqual(['filter', 'listenerFactory']);
    expect(runtime.listenerFactory).toHaveLength(0);
  });
});
