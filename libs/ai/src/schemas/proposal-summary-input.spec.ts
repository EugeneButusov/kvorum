import { describe, expect, it } from 'vitest';
import type { ProposalAction } from '@libs/db';
import {
  proposalSummaryInputContent,
  proposalSummaryInputHash,
  serializeDecodedActions,
} from './proposal-summary-input.js';
import {
  PROPOSAL_SUMMARY_SIGNALING_TEMPLATE,
  PROPOSAL_SUMMARY_TEMPLATE,
} from '../prompts/proposal-summary-template.js';
import { render } from '../prompts/renderer.js';

function action(index: number, overrides: Partial<ProposalAction> = {}): ProposalAction {
  return {
    id: `a-${index}`,
    proposal_id: 'prop-1',
    payload_index: 0,
    action_index: index,
    target_address: '0xTarget',
    target_chain_id: '1',
    value_wei: '0',
    function_signature: 'setReserveFactor(uint256)',
    calldata: '0xdead',
    decoded_function: 'setReserveFactor',
    decoded_arguments: { value: '150000000000000000' },
    created_at: new Date(),
    decode_status: 'decoded',
    decode_attempted_at: null,
    decode_attempt_count: 0,
    next_decode_at: null,
    ...overrides,
  };
}

describe('serializeDecodedActions', () => {
  it('is "[]" for no actions', () => {
    expect(serializeDecodedActions([])).toBe('[]');
  });

  it('is canonical, sorted by action_index, projected to the hash fields', () => {
    const json = serializeDecodedActions([action(1), action(0)]);
    const parsed = JSON.parse(json) as Record<string, unknown>[];
    expect(parsed.map((a) => a['action_index'])).toEqual([0, 1]);
    expect(parsed[0]).toEqual({
      action_index: 0,
      target_address: '0xTarget', // raw, not lowercased
      target_chain_id: '1',
      value_wei: '0',
      function_signature: 'setReserveFactor(uint256)',
      decoded_function: 'setReserveFactor',
      decoded_arguments: { value: '150000000000000000' },
    });
  });
});

describe('proposalSummaryInputHash', () => {
  it('is a sha256: hash, stable for identical content', () => {
    const h1 = proposalSummaryInputHash('body', [action(0)]);
    const h2 = proposalSummaryInputHash('body', [action(0)]);
    expect(h1).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(h1).toBe(h2);
  });

  it('changes when the description changes', () => {
    expect(proposalSummaryInputHash('a', [])).not.toBe(proposalSummaryInputHash('b', []));
  });
});

describe('drift guard — API derivation equals the worker render() inputContent', () => {
  it('matches the binding template render inputContent', () => {
    const actions = [action(0), action(1)];
    const viaRender = render(PROPOSAL_SUMMARY_TEMPLATE, {
      description: 'Raise the reserve factor.',
      decoded_actions: serializeDecodedActions(actions),
    }).inputContent;
    expect(proposalSummaryInputContent('Raise the reserve factor.', actions)).toBe(viaRender);
  });

  it('matches the signaling template render inputContent (no actions)', () => {
    const viaRender = render(PROPOSAL_SUMMARY_SIGNALING_TEMPLATE, {
      description: 'Should we fund growth?',
      decoded_actions: serializeDecodedActions([]),
    }).inputContent;
    expect(proposalSummaryInputContent('Should we fund growth?', [])).toBe(viaRender);
  });
});
