import { describe, expect, it } from 'vitest';
import type { DelegationReadRow } from '@libs/db';
import type { OffchainDelegationView } from '@libs/domain';
import { toDelegationListItemDto, toOffchainDelegationDto } from './delegation.mappers';

function row(over: Partial<DelegationReadRow> = {}): DelegationReadRow {
  return {
    id: 'd1',
    voting_power: '100',
    block_number: '99',
    tx_hash: '0xhash',
    event_type: 'delegate_changed',
    created_at: new Date('2026-01-02T03:04:05.678Z'),
    delegator_address: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    delegator_display_name: 'Alice',
    delegate_address: '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
    delegate_display_name: 'Bob',
    ...over,
  } as DelegationReadRow;
}

describe('toDelegationListItemDto', () => {
  it('maps a full row with lowercased embedded actors and iso-second created_at', () => {
    const dto = toDelegationListItemDto(row(), 'power-bearing');
    expect(dto).toEqual({
      delegation_id: 'd1',
      delegator: {
        address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        display_name: 'Alice',
        _meta: { links: { actor: '/v1/actors/0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' } },
      },
      delegate: {
        address: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        display_name: 'Bob',
        _meta: { links: { actor: '/v1/actors/0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' } },
      },
      voting_power: '100',
      block_number: '99',
      event_type: 'delegate_changed',
      model: 'power-bearing',
      tx_hash: '0xhash',
      created_at: '2026-01-02T03:04:05Z',
    });
    expect(Object.getPrototypeOf(dto).constructor.name).toBe('DelegationListItemDto');
  });

  it('maps delegate to null for an undelegation (delegate_address null)', () => {
    const dto = toDelegationListItemDto(
      row({ delegate_address: null, delegate_display_name: null }),
      'relationship-only',
    );
    expect(dto.delegate).toBeNull();
    expect(dto.model).toBe('relationship-only');
  });

  it('passes a null created_at through', () => {
    const dto = toDelegationListItemDto(row({ created_at: null }), 'power-bearing');
    expect(dto.created_at).toBeNull();
  });
});

describe('toOffchainDelegationDto', () => {
  const view: OffchainDelegationView = {
    platform: 'snapshot',
    system: 'split_delegation',
    scope: 'lido-snapshot.eth',
    network: '0x1',
    delegate_address: '0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
    weight: '0.5',
    expires_at: '2026-12-01T00:00:00Z',
  };

  it('maps the view and lowercases the delegate address', () => {
    const dto = toOffchainDelegationDto(view);
    expect(dto).toEqual({
      platform: 'snapshot',
      system: 'split_delegation',
      scope: 'lido-snapshot.eth',
      network: '0x1',
      delegate_address: '0xcccccccccccccccccccccccccccccccccccccccc',
      weight: '0.5',
      expires_at: '2026-12-01T00:00:00Z',
    });
    expect(Object.getPrototypeOf(dto).constructor.name).toBe('OffchainDelegationDto');
  });

  it('preserves null scope (global), weight (full), and expires_at (no expiry)', () => {
    const dto = toOffchainDelegationDto({
      ...view,
      scope: null,
      weight: null,
      expires_at: null,
    });
    expect(dto.scope).toBeNull();
    expect(dto.weight).toBeNull();
    expect(dto.expires_at).toBeNull();
  });
});
