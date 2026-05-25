import type { Actor } from '@libs/db';
import type { AnalyticsMetaDto } from './analytics-meta.dto';
import type { CrossDaoSummaryRow } from './analytics-read-repository';
import type { CrossDaoActorDto } from './cross-dao.dto';

export function toCrossDaoActorDto(args: {
  actor: Actor;
  summaries: CrossDaoSummaryRow[];
  alignmentByDaoId: Map<string, { matches: number; denom: number }>;
  meta: AnalyticsMetaDto;
}): CrossDaoActorDto {
  return {
    address: args.actor.primary_address,
    actor_id: args.actor.id,
    daos: args.summaries.map((s) => {
      const a = args.alignmentByDaoId.get(s.dao_id);
      const pct = a === undefined || a.denom === 0 ? null : a.matches / a.denom;
      return {
        dao_slug: s.dao_slug,
        votes_cast: s.votes_cast,
        proposals_proposed: 0,
        current_voting_power: '0',
        last_active_at: s.last_active_at?.toISOString() ?? null,
        alignment_with_majority_pct: pct,
      };
    }),
    _meta: args.meta,
  };
}
