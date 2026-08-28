import { sql, type Kysely } from 'kysely';
import type { PgDatabase } from '@libs/db';

export interface ProposalSearchRow {
  dao_slug: string;
  dao_name: string;
  source_type: string;
  source_id: string;
  title: string | null;
  state: string;
  voting_starts_at: Date | null;
  rank: number;
}

export interface DaoSearchRow {
  slug: string;
  name: string;
  description: string;
  rank: number;
}

export interface ActorSearchRow {
  display_name: string | null;
  primary_address: string;
  rank: number;
}

export class SearchReadRepository {
  constructor(private readonly db: Kysely<PgDatabase>) {}

  async searchProposals(query: string, limit: number): Promise<ProposalSearchRow[]> {
    const { rows } = await sql<ProposalSearchRow>`
      SELECT p.title, p.state, p.source_type, p.source_id,
             p.voting_starts_at,
             d.slug AS dao_slug, d.name AS dao_name,
             ts_rank_cd(p.search_vector, websearch_to_tsquery('english', ${query})) AS rank
      FROM proposal p
      JOIN dao d ON d.id = p.dao_id
      WHERE p.search_vector @@ websearch_to_tsquery('english', ${query})
      ORDER BY rank DESC
      LIMIT ${limit}
    `.execute(this.db);
    return rows;
  }

  async searchDaos(query: string, limit: number): Promise<DaoSearchRow[]> {
    const { rows } = await sql<DaoSearchRow>`
      SELECT slug, name, description,
             ts_rank_cd(search_vector, websearch_to_tsquery('english', ${query})) AS rank
      FROM dao
      WHERE search_vector @@ websearch_to_tsquery('english', ${query})
      ORDER BY rank DESC
      LIMIT ${limit}
    `.execute(this.db);
    return rows;
  }

  async searchActors(query: string, limit: number): Promise<ActorSearchRow[]> {
    const { rows } = await sql<ActorSearchRow>`
      SELECT display_name, primary_address,
             ts_rank_cd(search_vector, websearch_to_tsquery('english', ${query})) AS rank
      FROM actor
      WHERE search_vector @@ websearch_to_tsquery('english', ${query})
      ORDER BY rank DESC
      LIMIT ${limit}
    `.execute(this.db);
    return rows;
  }

  async lookupActorsByAddress(
    hexAddress: string,
    exact: boolean,
    limit: number,
  ): Promise<ActorSearchRow[]> {
    const lower = hexAddress.toLowerCase();
    const { rows } = exact
      ? await sql<ActorSearchRow>`
          SELECT DISTINCT ON (a.id) a.display_name, a.primary_address, 1.0 AS rank
          FROM actor a
          JOIN actor_address aa ON aa.actor_id = a.id
          WHERE aa.address = ${lower}
          ORDER BY a.id
          LIMIT ${limit}
        `.execute(this.db)
      : await sql<ActorSearchRow>`
          SELECT DISTINCT ON (a.id) a.display_name, a.primary_address, 1.0 AS rank
          FROM actor a
          JOIN actor_address aa ON aa.actor_id = a.id
          WHERE aa.address LIKE ${lower + '%'}
          ORDER BY a.id
          LIMIT ${limit}
        `.execute(this.db);
    return rows;
  }
}
