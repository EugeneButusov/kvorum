import type { EndpointQuery } from '../query/query-descriptor';

export const DAO_LIST_QUERY: EndpointQuery = {
  filters: {},
  sortable: {
    slug: { column: 'dao.slug' },
    created_at: { column: 'dao.created_at', kind: 'time' },
  },
  defaultSort: [{ field: 'slug', dir: 'asc' }],
  tiebreakColumn: 'dao.id',
};
