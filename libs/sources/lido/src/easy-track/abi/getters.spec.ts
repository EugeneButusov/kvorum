import { describe, expect, it } from 'vitest';
import { EASY_TRACK_GETTERS_INTERFACE, decodeGetMotions, encodeGetMotions } from './getters';

const FACTORY = '0x' + '22'.repeat(20);
const CREATOR = '0x' + '11'.repeat(20);
const HASH = '0x' + 'ab'.repeat(32);

describe('Easy Track getters', () => {
  it('encodeGetMotions encodes the no-arg getMotions selector', () => {
    expect(encodeGetMotions()).toBe(
      EASY_TRACK_GETTERS_INTERFACE.getFunction('getMotions')!.selector,
    );
  });

  it('decodeGetMotions maps the Motion tuple fields by position', () => {
    const raw = EASY_TRACK_GETTERS_INTERFACE.encodeFunctionResult('getMotions', [
      [[42n, FACTORY, CREATOR, 259200n, 1_767_225_600n, 18_000_000n, 50n, 0n, HASH]],
    ]);
    expect(decodeGetMotions(raw)).toEqual([
      {
        id: '42',
        evmScriptFactory: FACTORY,
        creator: CREATOR,
        duration: 259200,
        startDate: 1_767_225_600,
        snapshotBlock: '18000000',
        objectionsThreshold: '50',
        objectionsAmount: '0',
        evmScriptHash: HASH,
      },
    ]);
  });

  it('decodeGetMotions returns [] for an empty active set', () => {
    const raw = EASY_TRACK_GETTERS_INTERFACE.encodeFunctionResult('getMotions', [[]]);
    expect(decodeGetMotions(raw)).toEqual([]);
  });
});
