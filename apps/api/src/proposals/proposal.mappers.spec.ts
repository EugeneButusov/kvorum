import { toProposalDetailDto, toProposalListItemDto } from './proposal.mappers';

describe('proposal.mappers', () => {
  const row = {
    id: 'p1',
    dao_slug: 'compound',
    source_type: 'compound_governor',
    source_id: '42',
    title: 'Title',
    description: 'Desc',
    state: 'active',
    binding: true,
    voting_starts_at: new Date('2026-05-15T10:00:00.123Z'),
    voting_ends_at: null,
    voting_power_block: '19854210',
    state_updated_at: new Date('2026-05-15T11:00:00.456Z'),
    created_at: new Date('2026-05-15T09:00:00.789Z'),
    proposer_address: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    proposer_display_name: null,
  };

  it('maps list item without heavy fields', () => {
    const dto = toProposalListItemDto(row);
    expect(dto.proposer.address).toBe('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(dto.voting_power_block).toBe('19854210');
    expect((dto as Record<string, unknown>)['description']).toBeUndefined();
    expect((dto as Record<string, unknown>)['actions']).toBeUndefined();
    expect((dto as Record<string, unknown>)['choices']).toBeUndefined();
    expect((dto as Record<string, unknown>)['tally']).toBeUndefined();
    expect((dto as Record<string, unknown>)['forum']).toBeUndefined();
  });

  it('maps detail with actions/choices and second precision timestamps', () => {
    const dto = toProposalDetailDto(
      row,
      [
        {
          id: 'a1',
          proposal_id: 'p1',
          action_index: 0,
          target_address: '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
          target_chain_id: '1',
          value_wei: '0',
          function_signature: null,
          calldata: '0x',
          decoded_function: null,
          decoded_arguments: null,
          created_at: new Date(),
          decode_status: 'pending',
          decode_attempted_at: null,
          decode_attempt_count: 0,
          next_decode_at: null,
        },
      ],
      [{ proposal_id: 'p1', choice_index: 0, value: 'For' }],
    );

    expect(dto.voting_starts_at).toBe('2026-05-15T10:00:00Z');
    expect(dto._meta.confirmed).toBe(true);
    expect(dto.actions[0]?.target_address).toBe('0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
    expect(dto.choices[0]?.value).toBe('For');
    expect((dto as Record<string, unknown>)['tally']).toBeUndefined();
  });
});
