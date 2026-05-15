import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { getCursorConfig } from './cursor.config';
import { badRequestProblem, ProblemException } from '../http/problem-exception';
import type { ParsedQuery } from '../query/query-descriptor';

const cursorSchema = z.object({
  type: z.literal('time'),
  value: z.string().min(1),
  tiebreak: z.union([z.string(), z.number()]),
  dir: z.enum(['asc', 'desc']),
  q: z.string().min(2),
});

export type CursorPayload = z.infer<typeof cursorSchema>;

export function canonicalQuery(parsed: ParsedQuery): string {
  return stableStringify({
    filters: parsed.filters,
    sort: parsed.sort,
  });
}

export function encodeCursor(payload: CursorPayload): string {
  const json = JSON.stringify(payload);
  const encodedPayload = base64urlEncode(Buffer.from(json, 'utf8'));
  const tag = sign(encodedPayload);
  return `${encodedPayload}.${tag}`;
}

export function decodeCursor(raw: string): CursorPayload {
  const parts = raw.split('.');
  if (parts.length !== 2 || parts[0] === '' || parts[1] === '') {
    throw invalidCursor();
  }

  const encodedPayload = parts[0] as string;
  const providedTag = parts[1] as string;
  const expectedTag = sign(encodedPayload);

  const providedBuffer = Buffer.from(providedTag, 'utf8');
  const expectedBuffer = Buffer.from(expectedTag, 'utf8');
  if (
    providedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    throw invalidCursor();
  }

  let parsedJson: unknown;
  try {
    const payloadBytes = base64urlDecode(encodedPayload);
    parsedJson = JSON.parse(payloadBytes.toString('utf8'));
  } catch {
    throw invalidCursor();
  }

  const parsed = cursorSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw invalidCursor();
  }

  return parsed.data;
}

export function assertCursorMatchesQuery(cursor: CursorPayload, parsed: ParsedQuery): void {
  if (cursor.q !== canonicalQuery(parsed)) {
    throw badRequestProblem(
      'cursor-parameter-mismatch',
      [{ field: 'cursor', message: 'cursor does not match the request filters/sort' }],
      'Cursor does not match the request filters/sort.',
    );
  }
}

export function parseLimit(raw: unknown): number {
  if (raw === undefined || raw === null) {
    return 50;
  }

  const source = Array.isArray(raw) ? String(raw[0] ?? '') : String(raw);
  const trimmed = source.trim();
  if (trimmed === '') {
    return 50;
  }

  if (/^0x/i.test(trimmed)) {
    throw badRequestProblem('validation', [
      {
        field: 'limit',
        message: 'must be an integer between 1 and 200',
      },
    ]);
  }

  const value = Number(trimmed);
  if (Number.isNaN(value) || !Number.isInteger(value) || value < 1) {
    throw badRequestProblem('validation', [
      {
        field: 'limit',
        message: 'must be an integer between 1 and 200',
      },
    ]);
  }

  if (value > 200) {
    return 200;
  }

  return value;
}

export function buildPagination<T>(
  rows: T[],
  limit: number,
  sortKeyOf: (row: T) => Pick<CursorPayload, 'value' | 'tiebreak' | 'dir' | 'q'>,
): {
  data: T[];
  pagination: { limit: number; has_more: boolean; next_cursor: string | null };
} {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;

  if (data.length === 0) {
    return {
      data,
      pagination: {
        limit,
        has_more: false,
        next_cursor: null,
      },
    };
  }

  const lastRow = data[data.length - 1];
  const nextCursor =
    hasMore && lastRow !== undefined
      ? encodeCursor({
          type: 'time',
          ...sortKeyOf(lastRow),
        })
      : null;

  return {
    data,
    pagination: {
      limit,
      has_more: hasMore,
      next_cursor: nextCursor,
    },
  };
}

function invalidCursor(): ProblemException {
  return new ProblemException('invalid-cursor', 400, 'The cursor is invalid.');
}

function sign(payload: string): string {
  const { secret } = getCursorConfig();
  return base64urlEncode(createHmac('sha256', secret).update(payload, 'utf8').digest());
}

function base64urlEncode(bytes: Buffer): string {
  return bytes.toString('base64url');
}

function base64urlDecode(value: string): Buffer {
  return Buffer.from(value, 'base64url');
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortForCanonical(value));
}

function sortForCanonical(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.normalize('NFC');
  }

  if (Array.isArray(value)) {
    if (value.every(isScalar)) {
      return [...value].sort(compareScalars).map(sortForCanonical);
    }

    return value.map(sortForCanonical);
  }

  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    const out: Record<string, unknown> = {};
    for (const [key, child] of entries) {
      out[key] = sortForCanonical(child);
    }
    return out;
  }

  return value;
}

function isScalar(value: unknown): value is string | number | boolean | null {
  return (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === null
  );
}

function compareScalars(
  a: string | number | boolean | null,
  b: string | number | boolean | null,
): number {
  const left = String(a);
  const right = String(b);
  return left.localeCompare(right);
}
