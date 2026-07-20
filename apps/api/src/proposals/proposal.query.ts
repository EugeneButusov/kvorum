import { z } from 'zod';
import type { EndpointQuery } from '../query/query-descriptor';

const proposerAddress = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .transform((value) => value.toLowerCase());

const bindingBool = z.enum(['true', 'false']).transform((value) => value === 'true');

export const PER_DAO_PROPOSAL_QUERY: EndpointQuery = {
  filters: {
    state: { zod: z.string(), column: 'proposal.state', op: 'in', multi: true },
    source_type: { zod: z.string(), column: 'proposal.source_type', op: 'eq' },
    proposer: { zod: proposerAddress, column: 'actor.primary_address', op: 'eq' },
    binding: { zod: bindingBool, column: 'proposal.binding', op: 'eq' },
    voting_starts_at_min: {
      zod: z.string().datetime(),
      column: 'proposal.voting_starts_at',
      op: 'gte',
    },
    voting_starts_at_max: {
      zod: z.string().datetime(),
      column: 'proposal.voting_starts_at',
      op: 'lte',
    },
  },
  sortable: {
    voting_starts_at: { column: 'proposal.voting_starts_at', nullable: true, kind: 'time' },
    voting_ends_at: { column: 'proposal.voting_ends_at', nullable: true, kind: 'time' },
    created_at: { column: 'proposal.created_at', kind: 'time' },
    state_updated_at: { column: 'proposal.state_updated_at', kind: 'time' },
  },
  defaultSort: [{ field: 'created_at', dir: 'desc' }],
  tiebreakColumn: 'proposal.id',
};

export const CROSS_DAO_PROPOSAL_QUERY: EndpointQuery = {
  filters: {
    dao: {
      zod: z.string(),
      column: 'dao.slug',
      op: 'in',
      multi: true,
      doc: 'Comma-delimited DAO slugs',
    },
    state: { zod: z.string(), column: 'proposal.state', op: 'in', multi: true },
    binding: { zod: bindingBool, column: 'proposal.binding', op: 'eq' },
    voting_starts_at_min: {
      zod: z.string().datetime(),
      column: 'proposal.voting_starts_at',
      op: 'gte',
    },
    voting_starts_at_max: {
      zod: z.string().datetime(),
      column: 'proposal.voting_starts_at',
      op: 'lte',
    },
  },
  sortable: {
    voting_starts_at: { column: 'proposal.voting_starts_at', nullable: true, kind: 'time' },
    voting_ends_at: { column: 'proposal.voting_ends_at', nullable: true, kind: 'time' },
    created_at: { column: 'proposal.created_at', kind: 'time' },
    state_updated_at: { column: 'proposal.state_updated_at', kind: 'time' },
  },
  defaultSort: [{ field: 'created_at', dir: 'desc' }],
  tiebreakColumn: 'proposal.id',
};
