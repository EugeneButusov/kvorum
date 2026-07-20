// Data layer for the cross-DAO actor page (§6.10): fetch the actor identity, cross-DAO footprint,
// recent votes, and authored proposals, and shape them for the page + the alignment heatmap.

import type { createApiClient } from '@/lib/api/client';
import type { components } from '@/lib/api/schema';

type Api = ReturnType<typeof createApiClient>;

type CrossDaoActor = components['schemas']['CrossDaoActorDto'];
type CrossDaoSummary = components['schemas']['CrossDaoSummaryDto'];
type ActorVote = components['schemas']['ActorVoteListItemDto'];
type ActorProposal = components['schemas']['ActorProposalListItemDto'];

const POWER_DECIMALS = 18n;

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}
function num(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}
function scalePower(reported: string): number {
  try {
    const base = BigInt(reported);
    const whole = base / 10n ** POWER_DECIMALS;
    const frac = Number(base % 10n ** POWER_DECIMALS) / Number(10n ** POWER_DECIMALS);
    return Number(whole) + frac;
  } catch {
    return 0;
  }
}

// —— Identity ——————————————————————————————————————————————————————————————————————

export type ActorIdentity = {
  actorId: string;
  primaryAddress: string;
  displayName: string | null;
  addressCount: number;
};

export async function fetchActor(api: Api, address: string): Promise<ActorIdentity | null> {
  try {
    // The API 301s a merged/secondary address to the survivor's canonical URL; fetch follows it, so
    // `primary_address` here is the canonical one — the page redirects when it differs (ADR-033).
    const { data, error } = await api.GET('/v1/actors/{address}', {
      params: { path: { address } },
    });
    if (error || !data) return null;
    const actor = data.data;
    return {
      actorId: actor.actor_id,
      primaryAddress: actor.primary_address,
      displayName: str(actor.display_name),
      addressCount: actor.all_addresses.length,
    };
  } catch {
    return null;
  }
}

// —— Cross-DAO footprint ——————————————————————————————————————————————————————————

export type DaoFootprint = {
  slug: string;
  votingPower: number;
  votesCast: number;
  proposalsProposed: number;
  majorityAlignmentPct: number | null;
};

export function toFootprint(summary: CrossDaoSummary): DaoFootprint {
  return {
    slug: summary.dao_slug,
    votingPower: scalePower(summary.current_voting_power),
    votesCast: summary.votes_cast,
    proposalsProposed: summary.proposals_proposed,
    majorityAlignmentPct: num(summary.alignment_with_majority_pct),
  };
}

/** A one-line auto-bio from the indexed footprint (§6.10 §1). */
export function buildBio(footprints: DaoFootprint[]): string {
  if (footprints.length === 0) return 'No governance activity recorded yet.';
  const names = footprints.map((f) => f.slug);
  const daoList =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  const votes = footprints.reduce((sum, f) => sum + f.votesCast, 0);
  const proposals = footprints.reduce((sum, f) => sum + f.proposalsProposed, 0);
  const proposalClause =
    proposals > 0 ? `, authored ${proposals} proposal${proposals === 1 ? '' : 's'}` : '';
  return `Active in ${names.length} DAO${names.length === 1 ? '' : 's'} (${daoList}) — ${votes} vote${votes === 1 ? '' : 's'} cast${proposalClause}.`;
}

export async function fetchFootprint(api: Api, address: string): Promise<DaoFootprint[]> {
  try {
    const { data, error } = await api.GET('/v1/actors/{address}/analytics/cross-dao', {
      params: { path: { address } },
    });
    if (error || !data) return [];
    return (data as CrossDaoActor).daos
      .map(toFootprint)
      .sort((a, b) => b.votingPower - a.votingPower);
  } catch {
    return [];
  }
}

// —— Recent activity + authored proposals ————————————————————————————————————————

export type ActorVoteView = {
  voteId: string;
  daoSlug: string;
  sourceType: string;
  sourceId: string;
  title: string | null;
  state: string;
  primaryChoice: number | null;
  /** The proposal's own label for the choice ("for", "Option A"); null when it declares none. */
  choiceLabel: string | null;
  castAt: string | null;
  href: string;
};

export function toActorVote(dto: ActorVote): ActorVoteView {
  const p = dto.proposal;
  return {
    voteId: dto.vote_id,
    daoSlug: p.dao_slug,
    sourceType: p.source_type,
    sourceId: p.proposal_id,
    title: str(p.title),
    state: p.state,
    primaryChoice: num(dto.primary_choice),
    choiceLabel: str(dto.choice_label),
    castAt: str(dto.cast_at),
    href: `/daos/${p.dao_slug}/proposals/${p.source_type}/${p.proposal_id}`,
  };
}

export async function fetchActorVotes(
  api: Api,
  address: string,
  limit = 20,
): Promise<ActorVoteView[]> {
  try {
    const { data, error } = await api.GET('/v1/actors/{address}/votes', {
      params: { path: { address }, query: { limit, sort: '-cast_at' } },
    });
    if (error || !data) return [];
    return data.data.map(toActorVote);
  } catch {
    return [];
  }
}

export type AuthoredProposalView = {
  daoSlug: string;
  sourceType: string;
  sourceId: string;
  title: string | null;
  state: string;
  href: string;
};

export function toAuthored(dto: ActorProposal): AuthoredProposalView {
  return {
    daoSlug: dto.dao_slug,
    sourceType: dto.source_type,
    sourceId: dto.proposal_id,
    title: str(dto.title),
    state: dto.state,
    href: `/daos/${dto.dao_slug}/proposals/${dto.source_type}/${dto.proposal_id}`,
  };
}

export async function fetchAuthoredProposals(
  api: Api,
  address: string,
  limit = 20,
): Promise<AuthoredProposalView[]> {
  try {
    const { data, error } = await api.GET('/v1/actors/{address}/proposals', {
      params: { path: { address }, query: { limit, sort: '-created_at' } },
    });
    if (error || !data) return [];
    return data.data.map(toAuthored);
  } catch {
    return [];
  }
}
