// Default (public developer) key prefix. §4.3 reserves additional prefixes for tier/scope
// distinctions without breaking consumers — the session-scoped privileged key uses kv_dashboard_.
export const KEY_PREFIX = 'kv_live_';
export const DASHBOARD_KEY_PREFIX = 'kv_dashboard_';

export const KEY_PREFIXES = [KEY_PREFIX, DASHBOARD_KEY_PREFIX] as const;
export type KeyPrefix = (typeof KEY_PREFIXES)[number];

// 32 url-safe base64 chars after any known prefix. Longest prefix first so matching is unambiguous.
const KEY_PATTERN = new RegExp(
  `^(${[...KEY_PREFIXES].sort((a, b) => b.length - a.length).join('|')})[A-Za-z0-9_-]{32}$`,
);

export type ParsedBearerToken = {
  key: string;
  prefix: KeyPrefix;
};

export function parseBearerToken(authHeader: string | undefined): ParsedBearerToken | null {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.slice('Bearer '.length);
  if (!KEY_PATTERN.test(token)) {
    return null;
  }

  const prefix = KEY_PREFIXES.find((p) => token.startsWith(p));
  if (prefix === undefined) {
    return null;
  }

  return { key: token, prefix };
}
