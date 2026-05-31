import { decodePepper, pepperCandidates } from './pepper';

const key = 'kv_live_aB01_-aB01_-aB01_-aB01_-aB01_-aB';

function base64For(byte: number, length = 32): string {
  return Buffer.alloc(length, byte).toString('base64');
}

describe('decodePepper', () => {
  it('decodes valid base64 for 32 bytes', () => {
    const decoded = decodePepper(base64For(1));
    expect(decoded).toHaveLength(32);
  });

  it('throws on invalid base64 input', () => {
    expect(() => decodePepper('not-base64')).toThrow();
  });

  it('throws when decoded length is not 32 bytes', () => {
    expect(() => decodePepper(base64For(1, 16))).toThrow();
    expect(() => decodePepper(base64For(1, 64))).toThrow();
  });

  it('throws on empty value', () => {
    expect(() => decodePepper('')).toThrow();
  });

  it('throws on non-canonical base64 with non-zero trailing bits', () => {
    expect(() => decodePepper('AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAAB=')).toThrow();
  });
});

describe('pepperCandidates', () => {
  it('returns only current candidate when previous is absent', () => {
    const candidates = pepperCandidates(
      {
        current: Buffer.alloc(32, 1),
      },
      key,
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.pepper).toBe('current');
  });

  it('returns current then previous when previous exists', () => {
    const candidates = pepperCandidates(
      {
        current: Buffer.alloc(32, 1),
        previous: Buffer.alloc(32, 2),
      },
      key,
    );

    expect(candidates).toHaveLength(2);
    expect(candidates[0]?.pepper).toBe('current');
    expect(candidates[1]?.pepper).toBe('previous');
    expect(candidates[0]?.hash.equals(candidates[1]!.hash)).toBe(false);
  });
});
