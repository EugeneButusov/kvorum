import type { ZodType } from 'zod';

export type FilterOperator = 'eq' | 'in' | 'gte' | 'lte';

export type SortDirection = 'asc' | 'desc';

export type EndpointFilter = {
  zod: ZodType;
  multi?: boolean;
  column: string;
  op: FilterOperator;
  /**
   * How this filter is described in the OpenAPI document. Lives here rather than in a hand-written
   * DTO so the published contract is generated from the same declaration the parser enforces — the
   * two drifted apart before, and clients following the schema got 400s.
   */
  doc?: string;
  /** OpenAPI scalar type; defaults to string. */
  docType?: 'string' | 'number' | 'boolean';
};

export type EndpointSortable = {
  column: string;
  nullable?: boolean;
  kind?: 'time' | 'numeric' | 'bigint';
};

export type EndpointQuery = {
  filters: Record<string, EndpointFilter>;
  sortable: Record<string, EndpointSortable>;
  defaultSort: Array<{ field: string; dir: SortDirection }>;
  tiebreakColumn?: string;
};

export type ParsedScalar = string | number | boolean | null;

export type ParsedFilter = {
  field: string;
  column: string;
  op: FilterOperator;
  value: ParsedScalar | ParsedScalar[];
  multi: boolean;
};

export type ParsedSort = {
  field: string;
  column: string;
  dir: SortDirection;
  nullable: boolean;
  kind?: 'time' | 'numeric' | 'bigint';
};

export type ParsedQuery = {
  filters: Record<string, ParsedFilter>;
  sort: ParsedSort[];
};
