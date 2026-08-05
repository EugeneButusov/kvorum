import { describe, expect, it } from 'vitest';
import type { ProposalAction } from '@libs/db';
import {
  DESCRIPTION_CHAR_CAP,
  EMBEDDING_VERSION,
  proposalEmbeddingInputContent,
  proposalEmbeddingInputHash,
  summarizeActionsOneLine,
} from './proposal-embedding-input.js';

function action(over: Partial<ProposalAction>): ProposalAction {
  return {
    action_index: 0,
    target_address: '0x' + '1'.repeat(40),
    target_chain_id: '1',
    value_wei: '0',
    function_signature: null,
    decoded_function: null,
    decoded_arguments: null,
    ...over,
  } as ProposalAction;
}

describe('summarizeActionsOneLine', () => {
  it('lists decoded function names, counted, in action_index order (no de-dupe)', () => {
    const actions = [
      action({ action_index: 1, decoded_function: 'transfer' }),
      action({ action_index: 0, decoded_function: 'setReserveFactor' }),
      action({ action_index: 2, decoded_function: 'transfer' }),
    ];
    expect(summarizeActionsOneLine(actions)).toBe(
      'Actions (3): setReserveFactor, transfer, transfer',
    );
  });

  it('falls back decoded_function → bare signature name → "raw call"', () => {
    const actions = [
      action({ action_index: 0, decoded_function: 'foo' }),
      action({
        action_index: 1,
        decoded_function: null,
        function_signature: 'bar(uint256,address)',
      }),
      action({ action_index: 2, decoded_function: null, function_signature: null }),
    ];
    expect(summarizeActionsOneLine(actions)).toBe('Actions (3): foo, bar, raw call');
  });

  it('uses a sentinel line when there are no actions', () => {
    expect(summarizeActionsOneLine([])).toBe('No on-chain actions.');
  });
});

describe('proposalEmbeddingInputContent', () => {
  const actions = [action({ action_index: 0, decoded_function: 'setReserveFactor' })];

  it('composes title, description, and the action line as natural text', () => {
    expect(proposalEmbeddingInputContent('Raise reserve factor', 'Body text.', actions)).toBe(
      'Raise reserve factor\n\nBody text.\n\nActions (1): setReserveFactor',
    );
  });

  it('omits the title line when title is null or blank', () => {
    const expected = 'Body text.\n\nActions (1): setReserveFactor';
    expect(proposalEmbeddingInputContent(null, 'Body text.', actions)).toBe(expected);
    expect(proposalEmbeddingInputContent('   ', 'Body text.', actions)).toBe(expected);
  });

  it('caps the description deterministically', () => {
    const long = 'x'.repeat(DESCRIPTION_CHAR_CAP + 500);
    const out = proposalEmbeddingInputContent(null, long, []);
    expect(out).toBe('x'.repeat(DESCRIPTION_CHAR_CAP) + '\n\nNo on-chain actions.');
  });

  it('is deterministic and the hash is stable + sha256-shaped', () => {
    const a = proposalEmbeddingInputContent('T', 'D', actions);
    const b = proposalEmbeddingInputContent('T', 'D', actions);
    expect(a).toBe(b);
    const hash = proposalEmbeddingInputHash('T', 'D', actions);
    expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(proposalEmbeddingInputHash('T', 'D', actions)).toBe(hash);
  });

  // Golden snapshot — the version-control gate. Any change here MUST bump EMBEDDING_VERSION.
  it('matches the frozen golden composition for v1', () => {
    const composed = proposalEmbeddingInputContent('Grant funding', 'Fund the grants program.', [
      action({ action_index: 0, decoded_function: 'transfer' }),
      action({
        action_index: 1,
        decoded_function: null,
        function_signature: 'approve(address,uint256)',
      }),
    ]);
    expect(EMBEDDING_VERSION).toBe('text-embedding-3-small/v1');
    expect(composed).toBe(
      'Grant funding\n\nFund the grants program.\n\nActions (2): transfer, approve',
    );
  });
});
