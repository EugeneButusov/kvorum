import { randomBytes } from 'crypto';
import { KEY_PREFIX } from './bearer';

export interface GeneratedApiKey {
  key: string;
  prefix: string;
  lastFour: string;
}

export function generateApiKey(): GeneratedApiKey {
  const random = randomBytes(24).toString('base64url');
  const key = `${KEY_PREFIX}${random}`;
  return {
    key,
    prefix: KEY_PREFIX,
    lastFour: key.slice(-4),
  };
}
