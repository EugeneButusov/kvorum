import { Interface } from 'ethers';
import { describe, expect, it, vi } from 'vitest';
import {
  fetchCompoundVp,
  fetchAaveV2Vp,
  fetchAragonVp,
  SUPPORTED_VP_FETCHERS,
} from './backfill-eligible-vp.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'proposal-1',
    source_id: '42',
    source_type: 'compound_governor_bravo',
    voting_starts_block: '18000000',
    primary_token_address: '0xComp',
    chain_id: '0x1',
    voting_address: null as string | null,
    voting_strategy_address: null as string | null,
    ...overrides,
  };
}

function makeClient(returnValue: string) {
  return {
    send: vi.fn().mockResolvedValue(returnValue),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
  };
}

function encodeUint256(value: bigint): string {
  const iface = new Interface(['function f() returns (uint256)']);
  return iface.encodeFunctionResult('f', [value]);
}

// ── Dispatch map ─────────────────────────────────────────────────────────────

describe('SUPPORTED_VP_FETCHERS', () => {
  it('maps compound governor variants to the same fetcher', () => {
    expect(SUPPORTED_VP_FETCHERS.get('compound_governor_bravo')).toBe(fetchCompoundVp);
    expect(SUPPORTED_VP_FETCHERS.get('compound_governor_alpha')).toBe(fetchCompoundVp);
    expect(SUPPORTED_VP_FETCHERS.get('compound_governor_oz')).toBe(fetchCompoundVp);
  });

  it('maps aave governor v2', () => {
    expect(SUPPORTED_VP_FETCHERS.get('aave_governor_v2')).toBe(fetchAaveV2Vp);
  });

  it('maps aragon voting', () => {
    expect(SUPPORTED_VP_FETCHERS.get('aragon_voting')).toBe(fetchAragonVp);
  });

  it('returns undefined for unsupported source types', () => {
    expect(SUPPORTED_VP_FETCHERS.get('snapshot')).toBeUndefined();
    expect(SUPPORTED_VP_FETCHERS.get('easy_track')).toBeUndefined();
    expect(SUPPORTED_VP_FETCHERS.get('dual_governance')).toBeUndefined();
  });
});

// ── Compound fetcher ─────────────────────────────────────────────────────────

describe('fetchCompoundVp', () => {
  it('calls totalSupply at the correct block and decodes the result', async () => {
    const expectedVp = 10_000_000n * 10n ** 18n;
    const encoded = encodeUint256(expectedVp);
    const client = makeClient(encoded);
    const row = makeRow();

    const result = await fetchCompoundVp(row, client);

    expect(result).toBe(expectedVp);
    expect(client.send).toHaveBeenCalledOnce();
    const [method, params] = client.send.mock.calls[0]!;
    expect(method).toBe('eth_call');
    expect((params as unknown[])[1]).toBe(`0x${BigInt('18000000').toString(16)}`);
  });

  it('returns null when voting_starts_block is null', async () => {
    const client = makeClient('0x');
    const row = makeRow({ voting_starts_block: null });

    const result = await fetchCompoundVp(row, client);

    expect(result).toBeNull();
    expect(client.send).not.toHaveBeenCalled();
  });
});

// ── Aave v2 fetcher ──────────────────────────────────────────────────────────

describe('fetchAaveV2Vp', () => {
  it('calls getTotalVotingSupplyAt with the correct block number', async () => {
    const expectedVp = 16_000_000n * 10n ** 18n;
    const encoded = encodeUint256(expectedVp);
    const client = makeClient(encoded);
    const row = makeRow({
      source_type: 'aave_governor_v2',
      voting_strategy_address: '0xStrategy',
      voting_starts_block: '19500000',
    });

    const result = await fetchAaveV2Vp(row, client);

    expect(result).toBe(expectedVp);
    expect(client.send).toHaveBeenCalledOnce();
    const [, params] = client.send.mock.calls[0]!;
    const callParams = params as [{ to: string; data: string }, string];
    expect(callParams[0].to).toBe('0xStrategy');
    expect(callParams[1]).toBe(`0x${BigInt('19500000').toString(16)}`);
  });

  it('returns null when voting_starts_block is null', async () => {
    const client = makeClient('0x');
    const row = makeRow({
      source_type: 'aave_governor_v2',
      voting_strategy_address: '0xS',
      voting_starts_block: null,
    });

    expect(await fetchAaveV2Vp(row, client)).toBeNull();
    expect(client.send).not.toHaveBeenCalled();
  });

  it('returns null when voting_strategy_address is null', async () => {
    const client = makeClient('0x');
    const row = makeRow({ source_type: 'aave_governor_v2', voting_strategy_address: null });

    expect(await fetchAaveV2Vp(row, client)).toBeNull();
    expect(client.send).not.toHaveBeenCalled();
  });
});

// ── Aragon fetcher ───────────────────────────────────────────────────────────

describe('fetchAragonVp', () => {
  it('calls getVote and extracts votingPower', async () => {
    const expectedVp = 5_000_000n * 10n ** 18n;
    const iface = new Interface([
      'function getVote(uint256) view returns (bool, bool, uint64, uint64, uint64, uint64, uint256, uint256, uint256, bytes, uint8)',
    ]);
    const encoded = iface.encodeFunctionResult('getVote', [
      true, // open
      false, // executed
      1700000000, // startDate
      18000000, // snapshotBlock
      500000000000000000n, // supportRequired
      250000000000000000n, // minAcceptQuorum
      3_000_000n * 10n ** 18n, // yea
      1_000_000n * 10n ** 18n, // nay
      expectedVp, // votingPower
      '0x', // script
      0, // phase
    ]);
    const client = makeClient(encoded);
    const row = makeRow({
      source_type: 'aragon_voting',
      source_id: '180',
      voting_address: '0xVoting',
    });

    const result = await fetchAragonVp(row, client);

    expect(result).toBe(expectedVp);
    expect(client.send).toHaveBeenCalledOnce();
    const [, params] = client.send.mock.calls[0]!;
    const callParams = params as [{ to: string }, string];
    expect(callParams[0].to).toBe('0xVoting');
    expect(callParams[1]).toBe('latest');
  });

  it('returns null when voting_address is null', async () => {
    const client = makeClient('0x');
    const row = makeRow({ source_type: 'aragon_voting', voting_address: null });

    expect(await fetchAragonVp(row, client)).toBeNull();
    expect(client.send).not.toHaveBeenCalled();
  });
});
