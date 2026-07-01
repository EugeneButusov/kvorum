import { describe, expect, it } from 'vitest';
import type { ArchiveDerivationRow } from '@libs/db';
import { ZERO_DELEGATE_ADDRESS } from '@libs/db';
import { projectSplitDelegationEvent } from './delegation-projector';
import type { SplitDelegationEvent } from './types';

const ROW: ArchiveDerivationRow = {
  id: 'archive-1',
  source_type: 'snapshot_split_delegation',
  dao_source_id: 'src-1',
  chain_id: '0x1',
  block_number: '200',
  block_hash: '0xblock',
  tx_hash: '0xtx',
  log_index: 1,
  event_type: 'DelegationUpdated',
  received_at: new Date('2026-01-01T00:00:00Z'),
  derivation_attempt_count: 0,
};

const ACCOUNT = `0x${'11'.repeat(20)}`;
const D1 = `0x${'00'.repeat(12)}${'22'.repeat(20)}`;
const D2 = `0x${'00'.repeat(12)}${'33'.repeat(20)}`;
const CTX = { daoId: 'dao-1', network: '0x1' };

describe('projectSplitDelegationEvent', () => {
  it('fans a multi-delegate DelegationUpdated into N weighted "set" rows with expiry', () => {
    const event: SplitDelegationEvent = {
      type: 'DelegationUpdated',
      payload: {
        account: ACCOUNT,
        context: 'lido-snapshot.eth',
        delegation: [
          { delegate: D1, ratio: '3' },
          { delegate: D2, ratio: '1' },
        ],
        expirationTimestamp: '1893456000',
      },
    };
    const rows = projectSplitDelegationEvent(event, ROW, CTX);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      delegator_address: ACCOUNT,
      delegate_address: `0x${'22'.repeat(20)}`,
      space_id: 'lido-snapshot.eth',
      delegation_system: 'split_delegation',
      weight: '0.75',
      event_type: 'set',
    });
    expect(rows[1]?.weight).toBe('0.25');
    expect(rows[0]?.expires_at).toEqual(new Date(1893456000 * 1000));
  });

  it('treats expirationTimestamp 0 as no expiry', () => {
    const event: SplitDelegationEvent = {
      type: 'ExpirationUpdated',
      payload: {
        account: ACCOUNT,
        context: 'lido-snapshot.eth',
        delegation: [{ delegate: D1, ratio: '1' }],
        expirationTimestamp: '0',
      },
    };
    const rows = projectSplitDelegationEvent(event, ROW, CTX);
    expect(rows[0]?.expires_at).toBeNull();
  });

  it('projects DelegationCleared into a single zero-sentinel "clear" row', () => {
    const event: SplitDelegationEvent = {
      type: 'DelegationCleared',
      payload: { account: ACCOUNT, context: 'lido-snapshot.eth' },
    };
    const rows = projectSplitDelegationEvent(event, ROW, CTX);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ event_type: 'clear', delegate_address: ZERO_DELEGATE_ADDRESS });
  });

  it('projects an empty delegation array as a clear', () => {
    const event: SplitDelegationEvent = {
      type: 'DelegationUpdated',
      payload: {
        account: ACCOUNT,
        context: 'lido-snapshot.eth',
        delegation: [],
        expirationTimestamp: '0',
      },
    };
    const rows = projectSplitDelegationEvent(event, ROW, CTX);
    expect(rows[0]?.event_type).toBe('clear');
  });

  it('skips non-EVM (cross-chain) delegate ids and clears when all are skipped', () => {
    const crossChain = `0x${'11'}${'00'.repeat(11)}${'22'.repeat(20)}`;
    const event: SplitDelegationEvent = {
      type: 'DelegationUpdated',
      payload: {
        account: ACCOUNT,
        context: 'lido-snapshot.eth',
        delegation: [{ delegate: crossChain, ratio: '1' }],
        expirationTimestamp: '0',
      },
    };
    const rows = projectSplitDelegationEvent(event, ROW, CTX);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.event_type).toBe('clear');
  });

  it('returns no rows for OptOutStatusSet (no-op derive)', () => {
    const event: SplitDelegationEvent = {
      type: 'OptOutStatusSet',
      payload: { delegate: `0x${'22'.repeat(20)}`, context: 'lido-snapshot.eth', optout: true },
    };
    expect(projectSplitDelegationEvent(event, ROW, CTX)).toEqual([]);
  });
});
