import { describe, it, expect } from 'vitest';
import { decodeVoteChoice } from './vote-choice-decoder';

describe('decodeVoteChoice', () => {
  it('single-choice / basic → one 0-based entry', () => {
    expect(decodeVoteChoice('single-choice', 2, 3)).toEqual({
      kind: 'decoded',
      primaryChoice: 1,
      choices: [{ choice_index: 1, weight: '1.0' }],
    });
    expect(decodeVoteChoice('basic', 1, 3)).toEqual({
      kind: 'decoded',
      primaryChoice: 0,
      choices: [{ choice_index: 0, weight: '1.0' }],
    });
  });

  it('approval → one weight-1 entry per approved option; primary = first', () => {
    expect(decodeVoteChoice('approval', [1, 3], 3)).toEqual({
      kind: 'decoded',
      primaryChoice: 0,
      choices: [
        { choice_index: 0, weight: '1.0' },
        { choice_index: 2, weight: '1.0' },
      ],
    });
  });

  it('ranked-choice / copeland → preference order preserved; primary = first preference', () => {
    expect(decodeVoteChoice('ranked-choice', [3, 1, 2], 3)).toEqual({
      kind: 'decoded',
      primaryChoice: 2,
      choices: [
        { choice_index: 2, weight: '1.0' },
        { choice_index: 0, weight: '1.0' },
        { choice_index: 1, weight: '1.0' },
      ],
    });
    expect(decodeVoteChoice('copeland', [2, 1], 3).kind).toBe('decoded');
  });

  it('weighted → normalized fractions summing to 1.0, sorted desc by weight', () => {
    const result = decodeVoteChoice('weighted', { '1': 2, '2': 1 }, 3);
    expect(result).toEqual({
      kind: 'decoded',
      primaryChoice: 0,
      choices: [
        { choice_index: 0, weight: '0.666666666666666667' },
        { choice_index: 1, weight: '0.333333333333333333' },
      ],
    });
  });

  it('weighted → equal weights split 0.5/0.5', () => {
    const result = decodeVoteChoice('quadratic', { '1': 1, '2': 1 }, 2);
    if (result.kind !== 'decoded') throw new Error('expected decoded');
    expect(result.choices).toEqual([
      { choice_index: 0, weight: '0.5' },
      { choice_index: 1, weight: '0.5' },
    ]);
  });

  it('weighted → drops zero-weight options', () => {
    const result = decodeVoteChoice('weighted', { '1': 3, '2': 0 }, 2);
    if (result.kind !== 'decoded') throw new Error('expected decoded');
    expect(result.choices).toEqual([{ choice_index: 0, weight: '1.0' }]);
  });

  it('returns undecodable for unknown type, encrypted/malformed choice, or out-of-range index', () => {
    expect(decodeVoteChoice('shutter', '0xencrypted', 3).kind).toBe('undecodable');
    expect(decodeVoteChoice('single-choice', '0xencrypted', 3).kind).toBe('undecodable');
    expect(decodeVoteChoice('single-choice', 5, 3).kind).toBe('undecodable');
    expect(decodeVoteChoice('single-choice', 0, 3).kind).toBe('undecodable');
    expect(decodeVoteChoice('approval', [], 3).kind).toBe('undecodable');
    expect(decodeVoteChoice('approval', [1, 9], 3).kind).toBe('undecodable');
    expect(decodeVoteChoice('weighted', [1, 2], 3).kind).toBe('undecodable');
    expect(decodeVoteChoice('weighted', { '1': -1 }, 3).kind).toBe('undecodable');
    expect(decodeVoteChoice('weighted', {}, 3).kind).toBe('undecodable');
    expect(decodeVoteChoice(null, 1, 3).kind).toBe('undecodable');
  });
});
