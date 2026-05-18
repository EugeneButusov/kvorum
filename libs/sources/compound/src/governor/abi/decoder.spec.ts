import { keccak256, toUtf8Bytes } from 'ethers';
import { describe, it, expect } from 'vitest';
import type { LogEvent } from '@libs/chain';
import { decodeCompoundLog } from './decoder';
import { COMPOUND_EVENT_TOPICS, COMPOUND_GOVERNOR_INTERFACE } from './events';
import { DecodeError } from '../domain/types';

// Reference topic0 hashes from the canonical Compound GovernorBravoDelegate ABI.
// Computed via `keccak256(eventSignature)`. The ProposalCreated hash is widely known;
// the others are verified here as a regression guard against ethers upgrades.
// NOTE: compute authoritative values using ethers Interface at runtime to avoid hardcoding errors.

const KNOWN_TOPIC0S = {
  // keccak256 of the full canonical event signature (no param names)
  ProposalCreated: keccak256(
    toUtf8Bytes(
      'ProposalCreated(uint256,address,address[],uint256[],string[],bytes[],uint256,uint256,string)',
    ),
  ).toLowerCase(),
  ProposalQueued: keccak256(toUtf8Bytes('ProposalQueued(uint256,uint256)')).toLowerCase(),
  ProposalExecuted: keccak256(toUtf8Bytes('ProposalExecuted(uint256)')).toLowerCase(),
  ProposalCanceled: keccak256(toUtf8Bytes('ProposalCanceled(uint256)')).toLowerCase(),
};

function makeLog(overrides: Partial<LogEvent> = {}): LogEvent {
  return {
    sourceType: 'compound_governor',
    chainId: 1,
    blockNumber: 20000000n,
    blockHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab',
    txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef12',
    txIndex: 0,
    logIndex: 0,
    address: '0xc0da02939e1441f497fd74f78ce7decb17b66529',
    topics: [],
    data: '0x',
    ...overrides,
  };
}

/** Encode a ProposalCreated log using ethers Interface to get real ABI-encoded data. */
function encodeProposalCreated(args: {
  id: bigint;
  proposer: string;
  targets: string[];
  values: bigint[];
  signatures: string[];
  calldatas: string[];
  startBlock: bigint;
  endBlock: bigint;
  description: string;
}): { topics: string[]; data: string } {
  const encoded = COMPOUND_GOVERNOR_INTERFACE.encodeEventLog(
    COMPOUND_GOVERNOR_INTERFACE.getEvent('ProposalCreated')!,
    [
      args.id,
      args.proposer,
      args.targets,
      args.values,
      args.signatures,
      args.calldatas,
      args.startBlock,
      args.endBlock,
      args.description,
    ],
  );
  return { topics: encoded.topics as string[], data: encoded.data };
}

function encodeSimpleEvent(
  name: 'ProposalQueued' | 'ProposalExecuted' | 'ProposalCanceled',
  args: unknown[],
): { topics: string[]; data: string } {
  const encoded = COMPOUND_GOVERNOR_INTERFACE.encodeEventLog(
    COMPOUND_GOVERNOR_INTERFACE.getEvent(name)!,
    args,
  );
  return { topics: encoded.topics as string[], data: encoded.data };
}

describe('decodeCompoundLog', () => {
  it('#1 — decodes ProposalCreated with real ABI-encoded data', () => {
    const { topics, data } = encodeProposalCreated({
      id: 123n,
      proposer: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', // valid EIP-55 checksum (vitalik.eth)
      targets: ['0x1111111111111111111111111111111111111111'],
      values: [0n],
      signatures: ['transfer(address,uint256)'],
      calldatas: ['0xdeadbeef'],
      startBlock: 18000000n,
      endBlock: 18100000n,
      description: '# Proposal\nThis is a test proposal.',
    });

    const result = decodeCompoundLog(makeLog({ topics, data }));

    expect(result.type).toBe('ProposalCreated');
    if (result.type !== 'ProposalCreated') return;
    expect(result.payload.proposalId).toBe('123');
    expect(result.payload.proposer).toBe('0xd8da6bf26964af9d7eed9e03e53415d37aa96045');
    expect(result.payload.targets).toEqual(['0x1111111111111111111111111111111111111111']);
    expect(result.payload.values).toEqual(['0']);
    expect(result.payload.signatures).toEqual(['transfer(address,uint256)']);
    expect(result.payload.calldatas).toEqual(['0xdeadbeef']);
    expect(result.payload.startBlock).toBe('18000000');
    expect(result.payload.endBlock).toBe('18100000');
    expect(result.payload.description).toBe('# Proposal\nThis is a test proposal.');
  });

  it('#2 — decodes ProposalQueued with proposalId + eta as decimal strings', () => {
    const { topics, data } = encodeSimpleEvent('ProposalQueued', [42n, 1700000000n]);
    const result = decodeCompoundLog(makeLog({ topics, data }));

    expect(result.type).toBe('ProposalQueued');
    if (result.type !== 'ProposalQueued') return;
    expect(result.payload.proposalId).toBe('42');
    expect(result.payload.eta).toBe('1700000000');
  });

  it('#3 — decodes ProposalExecuted with single-field payload', () => {
    const { topics, data } = encodeSimpleEvent('ProposalExecuted', [99n]);
    const result = decodeCompoundLog(makeLog({ topics, data }));

    expect(result.type).toBe('ProposalExecuted');
    if (result.type !== 'ProposalExecuted') return;
    expect(result.payload.proposalId).toBe('99');
  });

  it('#4 — decodes ProposalCanceled with single-field payload', () => {
    const { topics, data } = encodeSimpleEvent('ProposalCanceled', [7n]);
    const result = decodeCompoundLog(makeLog({ topics, data }));

    expect(result.type).toBe('ProposalCanceled');
    if (result.type !== 'ProposalCanceled') return;
    expect(result.payload.proposalId).toBe('7');
  });

  it('#5 — address normalisation: proposer decoded lowercased regardless of checksum case', () => {
    // Use EIP-55 checksummed form of vitalik.eth to satisfy ethers encoder
    const { topics, data } = encodeProposalCreated({
      id: 1n,
      proposer: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      targets: [],
      values: [],
      signatures: [],
      calldatas: [],
      startBlock: 1n,
      endBlock: 2n,
      description: '',
    });
    const result = decodeCompoundLog(makeLog({ topics, data }));

    expect(result.type).toBe('ProposalCreated');
    if (result.type !== 'ProposalCreated') return;
    expect(result.payload.proposer).toBe('0xd8da6bf26964af9d7eed9e03e53415d37aa96045');
    expect(result.payload.targets).toEqual([]);
  });

  it('#6 — uint256 boundary: 2^256-1 survives round-trip as decimal string', () => {
    const maxUint256 = 2n ** 256n - 1n;
    const { topics, data } = encodeSimpleEvent('ProposalQueued', [maxUint256, maxUint256]);
    const result = decodeCompoundLog(makeLog({ topics, data }));

    expect(result.type).toBe('ProposalQueued');
    if (result.type !== 'ProposalQueued') return;
    expect(result.payload.proposalId).toBe(maxUint256.toString());
    expect(result.payload.eta).toBe(maxUint256.toString());
  });

  it('#6b — bigint array values decoded as decimal strings, not BigInt[]', () => {
    const { topics, data } = encodeProposalCreated({
      id: 1n,
      proposer: '0x1111111111111111111111111111111111111111',
      targets: ['0x2222222222222222222222222222222222222222'],
      values: [1000000000000000000n, 500000000000000000n],
      signatures: [''],
      calldatas: ['0x'],
      startBlock: 1n,
      endBlock: 2n,
      description: '',
    });
    const result = decodeCompoundLog(makeLog({ topics, data }));

    expect(result.type).toBe('ProposalCreated');
    if (result.type !== 'ProposalCreated') return;
    expect(result.payload.values).toEqual(['1000000000000000000', '500000000000000000']);
    // Ensure JSON.stringify does not throw (bigint would throw)
    expect(() => JSON.stringify(result.payload)).not.toThrow();
  });

  it('#7 — description with UTF-8 emoji + markdown survives unchanged', () => {
    const description = '# 🚀 Transfer Funds\n> **Important**: send 100 ETH\n\n`code`\n\t• item';
    const { topics, data } = encodeProposalCreated({
      id: 1n,
      proposer: '0x1111111111111111111111111111111111111111',
      targets: [],
      values: [],
      signatures: [],
      calldatas: [],
      startBlock: 1n,
      endBlock: 2n,
      description,
    });
    const result = decodeCompoundLog(makeLog({ topics, data }));

    expect(result.type).toBe('ProposalCreated');
    if (result.type !== 'ProposalCreated') return;
    expect(result.payload.description).toBe(description);
  });

  it('#8 — unknown topic0 throws DecodeError({ reason: "unknown_topic" })', () => {
    const log = makeLog({
      topics: ['0x0000000000000000000000000000000000000000000000000000000000000000'],
      data: '0x',
    });
    expect(() => decodeCompoundLog(log)).toThrow(DecodeError);
    try {
      decodeCompoundLog(log);
    } catch (err) {
      expect(err).toBeInstanceOf(DecodeError);
      expect((err as DecodeError).reason).toBe('unknown_topic');
    }
  });

  it('#9 — topic0 matches but data is truncated → throws DecodeError({ reason: "parse_failed" })', () => {
    const log = makeLog({
      topics: [COMPOUND_EVENT_TOPICS.ProposalCreated],
      data: '0xdeadbeef', // truncated / malformed ABI data
    });
    expect(() => decodeCompoundLog(log)).toThrow(DecodeError);
    try {
      decodeCompoundLog(log);
    } catch (err) {
      expect(err).toBeInstanceOf(DecodeError);
      expect((err as DecodeError).reason).toBe('parse_failed');
    }
  });

  it('#10 — topic0 regression: computed hashes match known canonical values', () => {
    expect(COMPOUND_EVENT_TOPICS.ProposalCreated).toBe(KNOWN_TOPIC0S.ProposalCreated);
    expect(COMPOUND_EVENT_TOPICS.ProposalQueued).toBe(KNOWN_TOPIC0S.ProposalQueued);
    expect(COMPOUND_EVENT_TOPICS.ProposalExecuted).toBe(KNOWN_TOPIC0S.ProposalExecuted);
    expect(COMPOUND_EVENT_TOPICS.ProposalCanceled).toBe(KNOWN_TOPIC0S.ProposalCanceled);
  });
});
