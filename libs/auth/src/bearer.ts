export const KEY_PREFIX = 'kv_live_';
const KEY_PATTERN = /^kv_live_[A-Za-z0-9_-]{32}$/;

export type ParsedBearerToken = {
  key: string;
  prefix: string;
};

export function parseBearerToken(authHeader: string | undefined): ParsedBearerToken | null {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.slice('Bearer '.length);
  if (!KEY_PATTERN.test(token)) {
    return null;
  }

  return {
    key: token,
    prefix: KEY_PREFIX,
  };
}
