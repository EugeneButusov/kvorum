import { describe, expect, it } from 'vitest';
import type { Proposal, ProposalAction, ProposalReadRepository } from '@libs/db';
import { MismatchAssembler } from './mismatch.assembler';

function proposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    id: 'prop-1',
    dao_id: 'dao-1',
    source_type: 'compound_governor_bravo',
    source_id: '42',
    proposer_actor_id: 'actor-1',
    title: 'Raise reserve factor',
    description: 'Raise the USDC reserve factor to 5%.',
    description_hash: 'a'.repeat(64),
    binding: true,
    voting_starts_at: null,
    voting_ends_at: null,
    voting_starts_block: null,
    voting_ends_block: null,
    state: 'active',
    state_updated_at: new Date('2026-01-01T00:00:00Z'),
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function action(index: number): ProposalAction {
  return {
    id: `a-${index}`,
    proposal_id: 'prop-1',
    payload_index: 0,
    action_index: index,
    target_address: '0xtarget',
    target_chain_id: '1',
    value_wei: '0',
    function_signature: 'setReserveFactor(uint256)',
    calldata: '0xdead',
    decoded_function: 'setReserveFactor',
    decoded_arguments: { value: '500000000000000000' },
    created_at: new Date(),
    decode_status: 'decoded',
    decode_attempted_at: null,
    decode_attempt_count: 0,
    next_decode_at: null,
  };
}

function fakeReads(actions: ProposalAction[]): ProposalReadRepository {
  return { findActions: async () => actions } as unknown as ProposalReadRepository;
}

describe('MismatchAssembler', () => {
  it('assembles a mismatch RenderedPrompt + CostContext from description + decoded actions', async () => {
    const assembler = new MismatchAssembler(fakeReads([action(0)]));
    const { rendered, ctx } = await assembler.assemble(proposal());
    expect(rendered.feature).toBe('mismatch_detector');
    expect(rendered.model).toBe('claude-sonnet-5');
    expect(rendered.messages[0]?.content).toContain('Raise the USDC reserve factor to 5%.');
    expect(rendered.messages[0]?.content).toContain('setReserveFactor');
    expect(ctx).toEqual({ daoId: 'dao-1', entityReference: 'proposal:prop-1' });
  });

  it('carries the decoded actions into the canonical inputContent', async () => {
    const assembler = new MismatchAssembler(fakeReads([action(0)]));
    const { rendered } = await assembler.assemble(proposal());
    // decoded actions land in the cache-key inputContent (as an escaped JSON string under the key)
    expect(rendered.inputContent).toContain('"decoded_actions":');
    expect(rendered.inputContent).toContain('setReserveFactor');
  });
});
