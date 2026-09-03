import { Interface } from 'ethers';
import { describe, expect, it, vi } from 'vitest';
import { aaveV2EligibleVpProvider, aaveV3EligibleVpProvider } from '@sources/aave';
import { compoundEligibleVpProvider } from '@sources/compound';
import type { EligibleVpProposalContext, EligibleVpRpcSend } from '@sources/core';
import { aragonEligibleVpProvider } from '@sources/lido';
import { buildVpFetcherMap } from '../plugins/eligible-vp-providers.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeCtx(overrides: Partial<EligibleVpProposalContext> = {}): EligibleVpProposalContext {
  return {
    sourceId: '42',
    votingStartsBlock: '18000000',
    primaryTokenAddress: '0xComp',
    votingAddress: null,
    votingStrategyAddress: null,
    ...overrides,
  };
}

function makeSend(returnValue: string): EligibleVpRpcSend {
  return vi.fn().mockResolvedValue(returnValue);
}

function encodeUint256(value: bigint): string {
  const iface = new Interface(['function f() returns (uint256)']);
  return iface.encodeFunctionResult('f', [value]);
}

// ── Registry map ────────────────────────────────────────────────────────────

describe('buildVpFetcherMap', () => {
  const map = buildVpFetcherMap([
    compoundEligibleVpProvider,
    aaveV2EligibleVpProvider,
    aaveV3EligibleVpProvider,
    aragonEligibleVpProvider,
  ]);

  it('maps compound governor variants to the same provider', () => {
    expect(map.get('compound_governor_bravo')).toBe(compoundEligibleVpProvider);
    expect(map.get('compound_governor_alpha')).toBe(compoundEligibleVpProvider);
    expect(map.get('compound_governor_oz')).toBe(compoundEligibleVpProvider);
  });

  it('maps aave governor v2', () => {
    expect(map.get('aave_governor_v2')).toBe(aaveV2EligibleVpProvider);
  });

  it('maps aave governance v3', () => {
    expect(map.get('aave_governance_v3')).toBe(aaveV3EligibleVpProvider);
  });

  it('maps aragon voting', () => {
    expect(map.get('aragon_voting')).toBe(aragonEligibleVpProvider);
  });

  it('returns undefined for unsupported source types', () => {
    expect(map.get('snapshot')).toBeUndefined();
    expect(map.get('easy_track')).toBeUndefined();
    expect(map.get('dual_governance')).toBeUndefined();
  });
});

// ── Compound provider ───────────────────────────────────────────────────────

describe('compoundEligibleVpProvider', () => {
  it('calls totalSupply at the correct block and decodes the result', async () => {
    const expectedVp = 10_000_000n * 10n ** 18n;
    const encoded = encodeUint256(expectedVp);
    const send = makeSend(encoded);
    const ctx = makeCtx();

    const result = await compoundEligibleVpProvider.fetchEligibleVp(ctx, send);

    expect(result).toBe(expectedVp);
    expect(send).toHaveBeenCalledOnce();
    const [method, params] = (send as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(method).toBe('eth_call');
    expect((params as unknown[])[1]).toBe(`0x${BigInt('18000000').toString(16)}`);
  });

  it('returns null when votingStartsBlock is null', async () => {
    const send = makeSend('0x');
    const ctx = makeCtx({ votingStartsBlock: null });

    const result = await compoundEligibleVpProvider.fetchEligibleVp(ctx, send);

    expect(result).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });
});

// ── Aave v2 provider ────────────────────────────────────────────────────────

describe('aaveV2EligibleVpProvider', () => {
  it('calls getTotalVotingSupplyAt with the correct block number', async () => {
    const expectedVp = 16_000_000n * 10n ** 18n;
    const encoded = encodeUint256(expectedVp);
    const send = makeSend(encoded);
    const ctx = makeCtx({
      votingStrategyAddress: '0xStrategy',
      votingStartsBlock: '19500000',
    });

    const result = await aaveV2EligibleVpProvider.fetchEligibleVp(ctx, send);

    expect(result).toBe(expectedVp);
    expect(send).toHaveBeenCalledOnce();
    const [, params] = (send as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const callParams = params as [{ to: string; data: string }, string];
    expect(callParams[0].to).toBe('0xStrategy');
    expect(callParams[1]).toBe(`0x${BigInt('19500000').toString(16)}`);
  });

  it('returns null when votingStartsBlock is null', async () => {
    const send = makeSend('0x');
    const ctx = makeCtx({ votingStrategyAddress: '0xS', votingStartsBlock: null });

    expect(await aaveV2EligibleVpProvider.fetchEligibleVp(ctx, send)).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it('returns null when votingStrategyAddress is null', async () => {
    const send = makeSend('0x');
    const ctx = makeCtx({ votingStrategyAddress: null });

    expect(await aaveV2EligibleVpProvider.fetchEligibleVp(ctx, send)).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });
});

// ── Aave v3 provider ───────────────────────────────────────────────────────

describe('aaveV3EligibleVpProvider', () => {
  it('calls totalSupply at the correct block and decodes the result', async () => {
    const expectedVp = 16_000_000n * 10n ** 18n;
    const encoded = encodeUint256(expectedVp);
    const send = makeSend(encoded);
    const ctx = makeCtx({ votingStartsBlock: '20000000' });

    const result = await aaveV3EligibleVpProvider.fetchEligibleVp(ctx, send);

    expect(result).toBe(expectedVp);
    expect(send).toHaveBeenCalledOnce();
    const [method, params] = (send as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(method).toBe('eth_call');
    expect((params as unknown[])[1]).toBe(`0x${BigInt('20000000').toString(16)}`);
  });

  it('returns null when votingStartsBlock is null', async () => {
    const send = makeSend('0x');
    const ctx = makeCtx({ votingStartsBlock: null });

    const result = await aaveV3EligibleVpProvider.fetchEligibleVp(ctx, send);

    expect(result).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });
});

// ── Aragon provider ─────────────────────────────────────────────────────────

describe('aragonEligibleVpProvider', () => {
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
    const send = makeSend(encoded);
    const ctx = makeCtx({
      sourceId: '180',
      votingAddress: '0xVoting',
    });

    const result = await aragonEligibleVpProvider.fetchEligibleVp(ctx, send);

    expect(result).toBe(expectedVp);
    expect(send).toHaveBeenCalledOnce();
    const [, params] = (send as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const callParams = params as [{ to: string }, string];
    expect(callParams[0].to).toBe('0xVoting');
    expect(callParams[1]).toBe('latest');
  });

  it('returns null when votingAddress is null', async () => {
    const send = makeSend('0x');
    const ctx = makeCtx({ votingAddress: null });

    expect(await aragonEligibleVpProvider.fetchEligibleVp(ctx, send)).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });
});
