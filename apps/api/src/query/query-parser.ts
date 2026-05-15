import type {
  EndpointQuery,
  ParsedFilter,
  ParsedQuery,
  ParsedScalar,
  ParsedSort,
  SortDirection,
} from './query-descriptor';
import { badRequestProblem, ProblemException } from '../http/problem-exception';

const RESERVED_PARAMS = new Set(['cursor', 'limit', 'sort']);

export function parseQuery(
  rawQuery: Record<string, unknown>,
  descriptor: EndpointQuery,
): ParsedQuery {
  for (const key of Object.keys(rawQuery)) {
    if (RESERVED_PARAMS.has(key)) {
      continue;
    }

    if (!(key in descriptor.filters)) {
      throw badRequestProblem('unknown-filter', [
        {
          field: key,
          message: `unknown filter parameter '${key}'`,
        },
      ]);
    }
  }

  const filters: Record<string, ParsedFilter> = {};
  for (const [field, def] of Object.entries(descriptor.filters)) {
    if (!(field in rawQuery)) {
      continue;
    }

    const input = rawQuery[field];
    if (def.multi) {
      const pieces = toStringArray(input).flatMap((part) => part.split(','));
      const parsed = pieces.map((part) => normalizeScalar(def.zod.parse(part)));
      filters[field] = {
        field,
        column: def.column,
        op: def.op,
        value: parsed,
        multi: true,
      };
      continue;
    }

    const parsed = normalizeScalar(def.zod.parse(firstValue(input)));
    filters[field] = {
      field,
      column: def.column,
      op: def.op,
      value: parsed,
      multi: false,
    };
  }

  return {
    filters,
    sort: parseSort(rawQuery['sort'], descriptor),
  };
}

function parseSort(rawSort: unknown, descriptor: EndpointQuery): ParsedSort[] {
  const tokens =
    rawSort === undefined ? [] : toStringArray(rawSort).flatMap((part) => part.split(','));

  if (tokens.length === 0) {
    return descriptor.defaultSort.map((entry) => {
      const sortable = descriptor.sortable[entry.field];
      if (sortable === undefined) {
        throw new ProblemException(
          'unknown-sort-field',
          400,
          `unknown sort field '${entry.field}'`,
          [
            {
              field: 'sort',
              message: `unknown sort field '${entry.field}'`,
            },
          ],
        );
      }

      return {
        field: entry.field,
        column: sortable.column,
        dir: entry.dir,
        nullable: sortable.nullable ?? false,
        kind: sortable.kind,
      };
    });
  }

  return tokens.map((token) => {
    const trimmed = token.trim();
    const dir: SortDirection = trimmed.startsWith('-') ? 'desc' : 'asc';
    const field = dir === 'desc' ? trimmed.slice(1) : trimmed;
    const sortable = descriptor.sortable[field];

    if (sortable === undefined) {
      throw badRequestProblem('unknown-sort-field', [
        {
          field: 'sort',
          message: `unknown sort field '${field}'`,
        },
      ]);
    }

    return {
      field,
      column: sortable.column,
      dir,
      nullable: sortable.nullable ?? false,
      kind: sortable.kind,
    };
  });
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry));
  }

  return [String(value)];
}

function firstValue(value: unknown): string {
  if (Array.isArray(value)) {
    return String(value[0] ?? '');
  }

  return String(value);
}

function normalizeScalar(value: unknown): ParsedScalar {
  if (typeof value === 'string') {
    return value.normalize('NFC');
  }

  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  throw new Error(`Unsupported parsed scalar type: ${typeof value}`);
}
