import { describe, expect, it } from 'vitest';
import type { ProposalAction } from '@libs/db';
import { mismatchInputContent, mismatchInputHash } from './mismatch-input.js';
import { serializeDecodedActions } from './proposal-summary-input.js';
import { MISMATCH_DETECTOR_TEMPLATE } from '../prompts/mismatch-detector-template.js';
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

describe('mismatchInputHash', () => {
  it('is a sha256: hash, stable for identical content', () => {
    const h1 = mismatchInputHash('body', [action(0)]);
    const h2 = mismatchInputHash('body', [action(0)]);
    expect(h1).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(h1).toBe(h2);
  });

  it('changes when the description changes', () => {
    expect(mismatchInputHash('a', [])).not.toBe(mismatchInputHash('b', []));
  });

  it('changes when the decoded actions change', () => {
    expect(mismatchInputHash('body', [action(0)])).not.toBe(mismatchInputHash('body', []));
  });
});

describe('drift guard — API derivation equals the worker render() inputContent', () => {
  it('matches the mismatch-detector template render inputContent', () => {
    const actions = [action(0), action(1)];
    const viaRender = render(MISMATCH_DETECTOR_TEMPLATE, {
      description: 'Raise the reserve factor.',
      decoded_actions: serializeDecodedActions(actions),
    }).inputContent;
    expect(mismatchInputContent('Raise the reserve factor.', actions)).toBe(viaRender);
  });
});
