import { describe, expect, it, vi } from 'vitest';
import type { LogEvent } from '@libs/chain';
import { DecodeError } from '@sources/core';
import { decodeAaveGovernorV2Log } from './decoder';
import { AAVE_GOVERNOR_V2_INTERFACE, AAVE_GOVERNOR_V2_TOPICS } from './events';

const GOVERNOR_ADDR = '0xec568fffba86c094cf06b22134b23074dfe2252c';
const CREATOR = '0x1111111111111111111111111111111111111111';
const EXECUTOR = '0x2222222222222222222222222222222222222222';
const VOTER = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const STRATEGY = '0x3333333333333333333333333333333333333333';
const IPFS_HASH = '0x' + '12'.repeat(32);

function makeLog(overrides: Partial<LogEvent> = {}): LogEvent {
  return {
    sourceType: 'aave_governor_v2',
    chainId: '0x1',
    blockNumber: 12000000n,
    blockHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
    txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    txIndex: 0,
    logIndex: 0,
    address: GOVERNOR_ADDR,
    topics: [],
    data: '0x',
    ...overrides,
  };
}

describe('decodeAaveGovernorV2Log', () => {
  it('decodes ProposalCreated with all fields', () => {
    const encoded = AAVE_GOVERNOR_V2_INTERFACE.encodeEventLog(
      AAVE_GOVERNOR_V2_INTERFACE.getEvent('ProposalCreated')!,
      [
        5n,
        CREATOR,
        EXECUTOR,
        ['0x4444444444444444444444444444444444444444'],
        [1_000_000_000_000_000_000n],
        ['transfer(address,uint256)'],
        ['0x5678'],
        [false],
        11_500_000n,
        11_550_000n,
        STRATEGY,
        IPFS_HASH,
      ],
    );

    const result = decodeAaveGovernorV2Log(
      makeLog({ topics: encoded.topics as string[], data: encoded.data }),
      'aave_governor_v2',
    );

    expect(result).toEqual({
      type: 'ProposalCreated',
      payload: {
        id: '5',
        creator: CREATOR,
        executor: EXECUTOR,
        targets: ['0x4444444444444444444444444444444444444444'],
        values: ['1000000000000000000'],
        signatures: ['transfer(address,uint256)'],
        calldatas: ['0x5678'],
        withDelegatecalls: [false],
        startBlock: '11500000',
        endBlock: '11550000',
        strategy: STRATEGY,
        ipfsHash: IPFS_HASH,
      },
    });
  });

  it('decodes VoteEmitted with support=true', () => {
    const encoded = AAVE_GOVERNOR_V2_INTERFACE.encodeEventLog(
      AAVE_GOVERNOR_V2_INTERFACE.getEvent('VoteEmitted')!,
      [7n, VOTER, true, 500_000_000_000_000_000_000n],
    );

    const result = decodeAaveGovernorV2Log(
      makeLog({ topics: encoded.topics as string[], data: encoded.data }),
      'aave_governor_v2',
    );

    expect(result).toEqual({
      type: 'VoteEmitted',
      payload: {
        id: '7',
        voter: VOTER,
        support: true,
        votingPower: '500000000000000000000',
      },
    });
  });

  it('decodes VoteEmitted with support=false', () => {
    const encoded = AAVE_GOVERNOR_V2_INTERFACE.encodeEventLog(
      AAVE_GOVERNOR_V2_INTERFACE.getEvent('VoteEmitted')!,
      [8n, VOTER, false, 100n],
    );

    const result = decodeAaveGovernorV2Log(
      makeLog({ topics: encoded.topics as string[], data: encoded.data }),
      'aave_governor_v2',
    );

    expect(result).toMatchObject({ type: 'VoteEmitted', payload: { support: false } });
  });

  it('decodes ProposalQueued (id is non-indexed, comes from data)', () => {
    const encoded = AAVE_GOVERNOR_V2_INTERFACE.encodeEventLog(
      AAVE_GOVERNOR_V2_INTERFACE.getEvent('ProposalQueued')!,
      [10n, 1_800_000_000n, '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'],
    );

    const result = decodeAaveGovernorV2Log(
      makeLog({ topics: encoded.topics as string[], data: encoded.data }),
      'aave_governor_v2',
    );

    expect(result).toEqual({
      type: 'ProposalQueued',
      payload: {
        id: '10',
        executionTime: '1800000000',
      },
    });
    // ProposalQueued has 2 topics (signature + indexed initiatorQueueing)
    expect(encoded.topics).toHaveLength(2);
  });

  it('decodes ProposalExecuted (id is non-indexed)', () => {
    const encoded = AAVE_GOVERNOR_V2_INTERFACE.encodeEventLog(
      AAVE_GOVERNOR_V2_INTERFACE.getEvent('ProposalExecuted')!,
      [11n, '0xcccccccccccccccccccccccccccccccccccccccc'],
    );

    const result = decodeAaveGovernorV2Log(
      makeLog({ topics: encoded.topics as string[], data: encoded.data }),
      'aave_governor_v2',
    );

    expect(result).toEqual({ type: 'ProposalExecuted', payload: { id: '11' } });
    // ProposalExecuted has 2 topics (signature + indexed initiatorExecution)
    expect(encoded.topics).toHaveLength(2);
  });

  it('decodes ProposalCanceled (no indexed params, only 1 topic)', () => {
    const encoded = AAVE_GOVERNOR_V2_INTERFACE.encodeEventLog(
      AAVE_GOVERNOR_V2_INTERFACE.getEvent('ProposalCanceled')!,
      [12n],
    );

    const result = decodeAaveGovernorV2Log(
      makeLog({ topics: encoded.topics as string[], data: encoded.data }),
      'aave_governor_v2',
    );

    expect(result).toEqual({ type: 'ProposalCanceled', payload: { id: '12' } });
    expect(encoded.topics).toHaveLength(1);
  });

  it('lowercases creator, executor, and strategy addresses', () => {
    const encoded = AAVE_GOVERNOR_V2_INTERFACE.encodeEventLog(
      AAVE_GOVERNOR_V2_INTERFACE.getEvent('ProposalCreated')!,
      [
        1n,
        '0xABCDEF1234567890ABCDEF1234567890ABCDEF12',
        '0xABCDEF1234567890ABCDEF1234567890ABCDEF13',
        [],
        [],
        [],
        [],
        [],
        100n,
        200n,
        '0xABCDEF1234567890ABCDEF1234567890ABCDEF14',
        '0x' + '00'.repeat(32),
      ],
    );

    const result = decodeAaveGovernorV2Log(
      makeLog({ topics: encoded.topics as string[], data: encoded.data }),
      'aave_governor_v2',
    );

    expect(result.type).toBe('ProposalCreated');
    if (result.type === 'ProposalCreated') {
      expect(result.payload.creator).toBe('0xabcdef1234567890abcdef1234567890abcdef12');
      expect(result.payload.executor).toBe('0xabcdef1234567890abcdef1234567890abcdef13');
      expect(result.payload.strategy).toBe('0xabcdef1234567890abcdef1234567890abcdef14');
    }
  });

  it('throws parse_failed on malformed data', () => {
    const encoded = AAVE_GOVERNOR_V2_INTERFACE.encodeEventLog(
      AAVE_GOVERNOR_V2_INTERFACE.getEvent('ProposalCanceled')!,
      [12n],
    );

    expect(() =>
      decodeAaveGovernorV2Log(
        makeLog({ topics: encoded.topics as string[], data: '0x1234' }),
        'aave_governor_v2',
      ),
    ).toThrow(DecodeError);

    try {
      decodeAaveGovernorV2Log(
        makeLog({ topics: encoded.topics as string[], data: '0x1234' }),
        'aave_governor_v2',
      );
    } catch (err) {
      expect((err as DecodeError).reason).toBe('parse_failed');
    }
  });

  it('throws unknown_topic when parseLog returns null', () => {
    vi.spyOn(AAVE_GOVERNOR_V2_INTERFACE, 'parseLog').mockReturnValueOnce(null);

    expect(() =>
      decodeAaveGovernorV2Log(
        makeLog({ topics: [AAVE_GOVERNOR_V2_TOPICS.ProposalCanceled], data: '0x' }),
        'aave_governor_v2',
      ),
    ).toThrow(DecodeError);
  });

  it('throws unknown_topic on unrecognised topicHash', () => {
    vi.spyOn(AAVE_GOVERNOR_V2_INTERFACE, 'parseLog').mockReturnValueOnce({
      name: 'Transfer',
      fragment: { topicHash: '0x' + 'ff'.repeat(32) },
    } as never);

    expect(() =>
      decodeAaveGovernorV2Log(
        makeLog({ topics: [AAVE_GOVERNOR_V2_TOPICS.ProposalCanceled], data: '0x' }),
        'aave_governor_v2',
      ),
    ).toThrow(DecodeError);
  });
});
