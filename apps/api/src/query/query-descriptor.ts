import type { ZodType } from 'zod';

export type FilterOperator = 'eq' | 'in' | 'gte' | 'lte';

export type SortDirection = 'asc' | 'desc';

export type EndpointFilter = {
  zod: ZodType;
  multi?: boolean;
  column: string;
  op: FilterOperator;
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
