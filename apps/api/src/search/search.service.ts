import { Injectable } from '@nestjs/common';
import type {
  ActorSearchRow,
  DaoSearchRow,
  ProposalSearchRow,
  SearchReadRepository,
} from './search-read-repository';
import { problemException } from '../http/problem-exception';

export type SearchEntityType = 'proposal' | 'dao' | 'actor';

export interface SearchResult {
  proposals: ProposalSearchRow[];
  daos: DaoSearchRow[];
  actors: ActorSearchRow[];
}

const ADDRESS_RE = /^0x[a-fA-F0-9]{4,40}$/i;
const MAX_QUERY_LENGTH = 200;
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 25;

@Injectable()
export class SearchService {
  constructor(private readonly repo: SearchReadRepository) {}

  async search(
    rawQuery: string,
    type: SearchEntityType | undefined,
    rawLimit: number | undefined,
  ): Promise<SearchResult> {
    const q = rawQuery.trim();
    if (q.length === 0) {
      throw problemException('validation', { detail: 'q must not be empty' });
    }

    const query = q.length > MAX_QUERY_LENGTH ? q.slice(0, MAX_QUERY_LENGTH) : q;
    const limit = Math.max(1, Math.min(MAX_LIMIT, rawLimit ?? DEFAULT_LIMIT));
    const isAddress = ADDRESS_RE.test(query);

    const wantProposals = type === undefined || type === 'proposal';
    const wantDaos = type === undefined || type === 'dao';
    const wantActors = type === undefined || type === 'actor';

    const [proposals, daos, actors] = await Promise.all([
      wantProposals ? this.repo.searchProposals(query, limit) : [],
      wantDaos ? this.repo.searchDaos(query, limit) : [],
      wantActors ? this.resolveActors(query, isAddress, limit) : [],
    ]);

    return { proposals, daos, actors };
  }

  private resolveActors(
    query: string,
    isAddress: boolean,
    limit: number,
  ): Promise<ActorSearchRow[]> {
    if (!isAddress) {
      return this.repo.searchActors(query, limit);
    }
    const hexBody = query.slice(2);
    const exact = hexBody.length === 40;
    return this.repo.lookupActorsByAddress(query, exact, limit);
  }
}
