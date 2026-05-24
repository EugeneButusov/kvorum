export const ERROR_BASE = 'urn:error';

export type ProblemSlug =
  | 'validation'
  | 'invalid-cursor'
  | 'cursor-parameter-mismatch'
  | 'unknown-filter'
  | 'unknown-sort-field'
  | 'unauthorized'
  | 'not-found'
  | 'actor-not-found'
  | 'rate-limited'
  | 'service-unavailable'
  | 'internal-error';

export type ProblemMeta = {
  defaultStatus: number;
  title: string;
};

export const PROBLEM_META: Record<ProblemSlug, ProblemMeta> = {
  validation: { defaultStatus: 400, title: 'Validation Error' },
  'invalid-cursor': { defaultStatus: 400, title: 'Invalid Cursor' },
  'cursor-parameter-mismatch': { defaultStatus: 400, title: 'Cursor Parameter Mismatch' },
  'unknown-filter': { defaultStatus: 400, title: 'Unknown Filter' },
  'unknown-sort-field': { defaultStatus: 400, title: 'Unknown Sort Field' },
  unauthorized: { defaultStatus: 401, title: 'Unauthorized' },
  'not-found': { defaultStatus: 404, title: 'Not Found' },
  'actor-not-found': { defaultStatus: 404, title: 'Actor Not Found' },
  'rate-limited': { defaultStatus: 429, title: 'Rate Limited' },
  'service-unavailable': { defaultStatus: 503, title: 'Service Unavailable' },
  'internal-error': { defaultStatus: 500, title: 'Internal Error' },
};

export function problemType(slug: ProblemSlug): string {
  return `${ERROR_BASE}:${slug}`;
}

export function slugFromHttpStatus(status: number): ProblemSlug {
  switch (status) {
    case 400:
      return 'validation';
    case 401:
      return 'unauthorized';
    case 404:
      return 'not-found';
    case 429:
      return 'rate-limited';
    case 503:
      return 'service-unavailable';
    default:
      return status >= 500 ? 'internal-error' : 'validation';
  }
}
