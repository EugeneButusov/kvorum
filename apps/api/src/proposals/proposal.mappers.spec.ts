import { toProposalDetailDto, toProposalListItemDto } from './proposal.mappers';

describe('proposal.mappers', () => {
  const row = {
    id: 'p1',
    dao_slug: 'compound',
    source_type: 'compound_governor_bravo',
    source_id: '42',
    title: 'Title',
    description: 'Desc',
    state: 'active',
    binding: true,
    voting_starts_at: new Date('2026-05-15T10:00:00.123Z'),
    voting_ends_at: null,
    state_updated_at: new Date('2026-05-15T11:00:00.456Z'),
    created_at: new Date('2026-05-15T09:00:00.789Z'),
    proposer_address: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    proposer_display_name: null,
  };

  it('maps list item without heavy fields', () => {
    const dto = toProposalListItemDto(row);
    expect(Object.getPrototypeOf(dto).constructor.name).toBe('ProposalListItemDto');
    expect(dto.proposer.address).toBe('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect((dto as Record<string, unknown>)['description']).toBeUndefined();
    expect((dto as Record<string, unknown>)['actions']).toBeUndefined();
    expect((dto as Record<string, unknown>)['choices']).toBeUndefined();
    expect((dto as Record<string, unknown>)['tally']).toBeUndefined();
    expect((dto as Record<string, unknown>)['forum']).toBeUndefined();
  });

  it('maps Compound detail without voting/payloads and second precision timestamps', () => {
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
      '0x1',
      null,
      [],
    );

    expect(dto.voting_starts_at).toBe('2026-05-15T10:00:00Z');
    expect(Object.getPrototypeOf(dto).constructor.name).toBe('ProposalDetailDto');
    expect(dto._meta.confirmed).toBe(true);
    expect(dto.actions[0]?.target_address).toBe('0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
    expect(dto.choices[0]?.value).toBe('For');
    expect(dto.origin_chain_id).toBe('0x1');
    expect((dto as Record<string, unknown>)['voting']).toBeUndefined();
    expect((dto as Record<string, unknown>)['payloads']).toBeUndefined();
    expect((dto as Record<string, unknown>)['tally']).toBeUndefined();
    expect(dto.metadata).toBeNull();
    expect(dto.offchain_discussion_links).toEqual([]);
  });

  it('surfaces source metadata and off-chain discussion links', () => {
    const extension = {
      voting: null,
      payloads: [],
      metadata: {
        kind: 'snapshot' as const,
        space_id: 'lido-snapshot.eth',
        voting_type: 'weighted',
        strategies: [{ name: 'erc20-balance-of' }],
        ipfs_hash: 'Qm...',
        network: '1',
        scores_state: 'final',
        flagged: false,
      },
    };
    const dto = toProposalDetailDto(row, [], [], '0x1', extension, [
      {
        platform: 'discourse',
        host: 'research.lido.fi',
        url: 'https://research.lido.fi/t/123',
        title: 'Proposal discussion',
        confidence: 'high',
        last_activity_at: '2026-05-15T09:00:00Z',
      },
    ]);

    expect(dto.metadata).toEqual(extension.metadata);
    expect(dto.offchain_discussion_links).toHaveLength(1);
    expect(dto.offchain_discussion_links[0]?.confidence).toBe('high');
    expect(dto.offchain_discussion_links[0]?.platform).toBe('discourse');
    expect(dto.offchain_discussion_links[0]?.url).toBe('https://research.lido.fi/t/123');
    expect(Object.getPrototypeOf(dto.offchain_discussion_links[0]).constructor.name).toBe(
      'OffchainDiscussionLinkDto',
    );
  });

  it('maps Aave detail with voting and grouped payloads', () => {
    const extension = {
      voting: {
        voting_chain_id: '0x89',
        voting_machine_address: '0xmachine',
        voting_strategy_address: null,
        creation_block: '100',
      },
      payloads: [
        {
          payload_index: 0,
          target_chain_id: '0x1',
          payloads_controller_address: '0xctrl',
          payload_id: '1',
          status: 'executed' as const,
          executed_at_destination: '2026-01-01T00:00:00Z',
          unindexed_target_chain: false,
        },
        {
          payload_index: 1,
          target_chain_id: '0x1',
          payloads_controller_address: '0xctrl',
          payload_id: '2',
          status: 'queued' as const,
          executed_at_destination: null,
          unindexed_target_chain: false,
        },
        {
          payload_index: 2,
          target_chain_id: '0x89',
          payloads_controller_address: '0xctrl2',
          payload_id: '3',
          status: 'created' as const,
          executed_at_destination: null,
          unindexed_target_chain: false,
        },
      ],
      metadata: null,
    };

    const dto = toProposalDetailDto(row, [], [], '0x1', extension, []);
    expect(dto.origin_chain_id).toBe('0x1');
    expect(dto.voting).toEqual(extension.voting);
    expect(dto.payloads).toHaveLength(2);
    const mainnetGroup = dto.payloads?.find((g) => g.target_chain_id === '0x1');
    expect(mainnetGroup?.payloads).toHaveLength(2);
    const polygonGroup = dto.payloads?.find((g) => g.target_chain_id === '0x89');
    expect(polygonGroup?.payloads).toHaveLength(1);
  });

  it('keeps nullable title as null and does not leak undefined own-properties', () => {
    const dto = toProposalListItemDto({ ...row, title: null });
    expect(dto.title).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(dto, 'title')).toBe(true);
    expect(Object.values(dto).includes(undefined)).toBe(false);
  });
});
