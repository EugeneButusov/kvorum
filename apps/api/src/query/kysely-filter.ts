import type { SelectQueryBuilder } from 'kysely';
import { sql } from 'kysely';
import type { EndpointQuery, ParsedQuery } from './query-descriptor';
import type { CursorPayload } from '../pagination/cursor';

type CursorForApply = Pick<CursorPayload, 'value' | 'tiebreak' | 'dir'>;

export function applyQuery<DB, TB extends keyof DB, O>(
  qb: SelectQueryBuilder<DB, TB, O>,
  parsed: ParsedQuery,
  descriptor: EndpointQuery,
  limit: number,
  cursor?: CursorForApply,
): SelectQueryBuilder<DB, TB, O> {
  let out = qb;

  for (const filter of Object.values(parsed.filters)) {
    if (filter.op === 'in') {
      const values = Array.isArray(filter.value) ? filter.value : [filter.value];
      out = out.where(filter.column as never, 'in', values as never);
      continue;
    }

    out = out.where(filter.column as never, toComparator(filter.op), filter.value as never);
  }

  for (const sort of parsed.sort) {
    const expr = sortExpression(sort.column, sort.dir, sort.nullable, sort.kind);
    out = out.orderBy(expr as never, sort.dir);
  }

  const tiebreak = descriptor.tiebreakColumn ?? 'id';
  out = out.orderBy(tiebreak as never, parsed.sort[0]?.dir ?? 'asc');

  if (cursor !== undefined && parsed.sort[0] !== undefined) {
    const primarySort = parsed.sort[0];
    const expr = sortExpression(
      primarySort.column,
      primarySort.dir,
      primarySort.nullable,
      primarySort.kind,
    );

    if (cursor.dir === 'asc') {
      out = out.where(({ eb, or, and }) =>
        or([
          eb(expr, '>', cursor.value),
          and([eb(expr, '=', cursor.value), eb(tiebreak as never, '>', cursor.tiebreak as never)]),
        ]),
      );
    } else {
      out = out.where(({ eb, or, and }) =>
        or([
          eb(expr, '<', cursor.value),
          and([eb(expr, '=', cursor.value), eb(tiebreak as never, '<', cursor.tiebreak as never)]),
        ]),
      );
    }
  }

  return out.limit(limit + 1);
}

function toComparator(op: 'eq' | 'gte' | 'lte'): '=' | '>=' | '<=' {
  switch (op) {
    case 'eq':
      return '=';
    case 'gte':
      return '>=';
    case 'lte':
      return '<=';
  }
}

function sortExpression(column: string, dir: 'asc' | 'desc', nullable: boolean, kind?: 'time') {
  if (!nullable) {
    if (kind === 'time') {
      return sql`date_trunc('milliseconds', ${sql.raw(column)})`;
    }
    return sql.raw(column);
  }

  const sentinel = dir === 'asc' ? `'infinity'::timestamptz` : `'-infinity'::timestamptz`;
  const nullableExpr = sql`coalesce(${sql.raw(column)}, ${sql.raw(sentinel)})`;
  if (kind === 'time') {
    return sql`date_trunc('milliseconds', ${nullableExpr})`;
  }

  return nullableExpr;
}
