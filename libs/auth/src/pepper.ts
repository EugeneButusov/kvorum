import { hashApiKey } from './hash';

const BASE64_32_BYTE_PATTERN = /^(?:[A-Za-z0-9+/]{4}){10}(?:[A-Za-z0-9+/]{3}=)$/;

type PepperLabel = 'current' | 'previous';

export type PepperSet = {
  current: Buffer;
  previous?: Buffer;
};

export type PepperCandidate = {
  pepper: PepperLabel;
  hash: Buffer;
};

export function decodePepper(raw: string): Buffer {
  if (!BASE64_32_BYTE_PATTERN.test(raw)) {
    throw new Error('Pepper must be canonical base64 of exactly 32 bytes');
  }

  const decoded = Buffer.from(raw, 'base64');
  /* v8 ignore next -- unreachable: BASE64_32_BYTE_PATTERN fixes length to 44 chars → decode is always 32 bytes */
  if (decoded.length !== 32) {
    throw new Error('Pepper must decode to exactly 32 bytes');
  }

  if (decoded.toString('base64') !== raw) {
    throw new Error('Pepper must be canonical base64 encoding');
  }

  return decoded;
}

export function pepperCandidates(pepperSet: PepperSet, key: string): PepperCandidate[] {
  const current = {
    pepper: 'current' as const,
    hash: hashApiKey(pepperSet.current, key),
  };

  if (!pepperSet.previous) {
    return [current];
  }

  return [
    current,
    {
      pepper: 'previous' as const,
      hash: hashApiKey(pepperSet.previous, key),
    },
  ];
}
