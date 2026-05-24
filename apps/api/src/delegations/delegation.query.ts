import { z } from 'zod';
import type { EndpointQuery } from '../query/query-descriptor';

const blockNumber = z.string().regex(/^\d{1,20}$/);

export const DELEGATION_QUERY: EndpointQuery = {
  filters: {
    delegator: {
      zod: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
      column: 'delegator.primary_address',
      op: 'eq',
    },
    delegate: {
      zod: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
      column: 'delegate.primary_address',
      op: 'eq',
    },
    from_block_min: {
      zod: blockNumber,
      column: 'delegation.block_number',
      op: 'gte',
    },
    from_block_max: {
      zod: blockNumber,
      column: 'delegation.block_number',
      op: 'lte',
    },
  },
  sortable: {
    block_number: { column: 'delegation.block_number', kind: 'bigint' },
    created_at: { column: 'delegation.created_at', kind: 'time' },
  },
  defaultSort: [{ field: 'block_number', dir: 'desc' }],
  tiebreakColumn: 'delegation.id',
};
