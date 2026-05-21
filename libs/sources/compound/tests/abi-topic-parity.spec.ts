import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Interface } from 'ethers';
import { describe, expect, it } from 'vitest';

function loadAbi(name: 'alpha' | 'bravo' | 'oz') {
  const p = join(__dirname, 'fixtures', 'abis', `${name}.json`);
  return JSON.parse(readFileSync(p, 'utf8')) as unknown[];
}

describe('governor ABI topic parity fixtures', () => {
  it('#18 — shared proposal topics are equal across alpha/bravo/oz fixtures', () => {
    const alpha = new Interface(loadAbi('alpha'));
    const bravo = new Interface(loadAbi('bravo'));
    const oz = new Interface(loadAbi('oz'));

    const names = [
      'ProposalCreated',
      'ProposalQueued',
      'ProposalExecuted',
      'ProposalCanceled',
    ] as const;
    for (const name of names) {
      const a = alpha.getEvent(name)!.topicHash.toLowerCase();
      const b = bravo.getEvent(name)!.topicHash.toLowerCase();
      const o = oz.getEvent(name)!.topicHash.toLowerCase();
      expect(a).toBe(b);
      expect(b).toBe(o);
    }
  });

  it('VoteCast topic differs for alpha and matches between bravo/oz', () => {
    const alpha = new Interface(loadAbi('alpha'));
    const bravo = new Interface(loadAbi('bravo'));
    const oz = new Interface(loadAbi('oz'));

    const a = alpha.getEvent('VoteCast')!.topicHash.toLowerCase();
    const b = bravo.getEvent('VoteCast')!.topicHash.toLowerCase();
    const o = oz.getEvent('VoteCast')!.topicHash.toLowerCase();

    expect(a).not.toBe(b);
    expect(b).toBe(o);
  });
});
