import { Injectable } from '@nestjs/common';
import { SimilarProposalsRepository, type SimilarProposalFilters } from '@libs/ai';
import { isoSeconds } from '@libs/db';
import { SimilarProposalItemDto } from './similar-proposals.dto';

/**
 * Reads a proposal's cross-DAO nearest neighbours by embedding (SPEC §5.8), mapping the repo rows to
 * API DTOs. Keeps `SimilarProposalsRepository` internal to its module (only this service is exported).
 * Returns `[]` when the target proposal has no current embedding — the graceful-degrade contract.
 */
@Injectable()
export class SimilarProposalsReadService {
  constructor(private readonly repo: SimilarProposalsRepository) {}

  async findSimilar(
    proposalId: string,
    filters: SimilarProposalFilters,
  ): Promise<SimilarProposalItemDto[]> {
    const rows = await this.repo.findSimilar(proposalId, filters);
    return rows.map((r) =>
      Object.assign(new SimilarProposalItemDto(), {
        dao_slug: r.dao_slug,
        dao_name: r.dao_name,
        source_type: r.source_type,
        source_id: r.source_id,
        title: r.title,
        state: r.state,
        created_at: isoSeconds(r.created_at),
        voting_starts_at: isoSeconds(r.voting_starts_at),
        voting_ends_at: isoSeconds(r.voting_ends_at),
        similarity: r.similarity,
      }),
    );
  }
}
