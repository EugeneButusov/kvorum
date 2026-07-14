// Data layer for the delegate scorecard (§6.11): fetch + transform the actor / vote / alignment
// endpoints into the shapes the header, participation grid, alignment heatmap, and history consume.

import type { createApiClient } from '@/lib/api/client';
import type { components } from '@/lib/api/schema';

type Api = ReturnType<typeof createApiClient>;
type ActorVote = components['schemas']['ActorVoteListItemDto'];
type AlignmentPeer = components['schemas']['DelegateAlignmentPeerDto'];

/** The proposal fields the participation grid needs (matches the normalized list-item view). */
export type GridProposal = { sourceType: string; sourceId: string; title: string | null };

const POWER_DECIMALS = 18n;

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
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

/** Pull (source_type, source_id) out of an embedded proposal's API link. */
export function parseProposalLink(link: string): { sourceType: string; sourceId: string } | null {
  const m = /\/proposals\/([^/]+)\/([^/?#]+)/.exec(link);
  return m ? { sourceType: m[1]!, sourceId: m[2]! } : null;
}

// —— Delegate profile ——————————————————————————————————————————————————————————————

export type DelegateProfile = {
  address: string;
  name: string | null;
  currentPower: number | null;
  votesCast: number | null;
  alignmentPct: number | null;
};

export async function fetchDelegateProfile(
  api: Api,
  slug: string,
  address: string,
): Promise<DelegateProfile> {
  const base: DelegateProfile = {
    address,
    name: null,
    currentPower: null,
    votesCast: null,
    alignmentPct: null,
  };
  try {
    const [actor, cross] = await Promise.all([
      api.GET('/v1/actors/{address}', { params: { path: { address } } }),
      api.GET('/v1/actors/{address}/analytics/cross-dao', { params: { path: { address } } }),
    ]);
    if (actor.data) base.name = str(actor.data.data.display_name);
    const dao = cross.data?.daos.find((d) => d.dao_slug === slug);
    if (dao) {
      base.currentPower = scalePower(dao.current_voting_power);
      base.votesCast = dao.votes_cast;
      base.alignmentPct =
        typeof dao.alignment_with_majority_pct === 'number'
          ? dao.alignment_with_majority_pct
          : null;
    }
    return base;
  } catch {
    return base;
  }
}

// —— Votes ————————————————————————————————————————————————————————————————————————

export type DelegateVote = {
  voteId: string;
  key: string; // `${sourceType}:${sourceId}` — joins to the proposal list
  sourceType: string;
  title: string | null;
  state: string;
  choice: number | null;
  power: number;
  castAt: string | null;
  href: string | null;
};

function normalizeVote(dto: ActorVote): DelegateVote | null {
  const parsed = parseProposalLink(dto.proposal._meta.links.proposal);
  const p = dto.proposal;
  return {
    voteId: dto.vote_id,
    key: parsed ? `${parsed.sourceType}:${parsed.sourceId}` : p.proposal_id,
    sourceType: p.source_type,
    title: str(p.title),
    state: p.state,
    choice: typeof dto.primary_choice === 'number' ? dto.primary_choice : null,
    power: scalePower(dto.voting_power_reported),
    castAt: str(dto.cast_at),
    href: parsed ? `/daos/${p.dao_slug}/proposals/${parsed.sourceType}/${parsed.sourceId}` : null,
  };
}

export async function fetchDelegateVotes(
  api: Api,
  slug: string,
  address: string,
  limit = 200,
): Promise<DelegateVote[]> {
  try {
    const { data, error } = await api.GET('/v1/actors/{address}/votes', {
      params: { path: { address }, query: { dao: slug, sort: '-cast_at', limit } },
    });
    if (error || !data) return [];
    return data.data.map(normalizeVote).filter((v): v is DelegateVote => v !== null);
  } catch {
    return [];
  }
}

// —— Voting-power trajectory (§1 sparkline / §2 chart) —————————————————————————————
// No historical-VP endpoint exists; the delegate's voting_power_reported at each vote is an honest
// trajectory at the moments they voted. Ordered oldest→newest.

export function powerTrajectory(votes: DelegateVote[]): { buckets: string[]; values: number[] } {
  const dated = votes
    .filter((v) => v.castAt)
    .slice()
    .sort((a, b) => (a.castAt! < b.castAt! ? -1 : 1));
  return {
    buckets: dated.map((v) => (v.castAt ? v.castAt.slice(0, 7) : '')),
    values: dated.map((v) => v.power),
  };
}

// —— Participation grid (§3) ——————————————————————————————————————————————————————
// One cell per proposal: did the delegate vote, and (by choice index) how. Choice *labels*
// (for/against/abstain) aren't carried in the actor-votes context, so cells are coloured by choice
// index rather than claiming vote semantics; the reliable-vs-fair-weather read comes from voted/missed.

export type ParticipationCell = {
  key: string;
  title: string;
  voted: boolean;
  choiceIndex: number | null;
};

export function participation(
  proposals: GridProposal[],
  votes: DelegateVote[],
): { cells: ParticipationCell[]; rate: number } {
  const voteByKey = new Map(votes.map((v) => [v.key, v]));
  const cells: ParticipationCell[] = proposals.map((p) => {
    const key = `${p.sourceType}:${p.sourceId}`;
    const vote = voteByKey.get(key);
    return {
      key,
      title: p.title ?? `#${p.sourceId}`,
      voted: vote != null,
      choiceIndex: vote?.choice ?? null,
    };
  });
  const voted = cells.filter((c) => c.voted).length;
  return { cells, rate: cells.length ? Math.round((voted / cells.length) * 100) : 0 };
}

// —— Alignment heatmap (§4) ————————————————————————————————————————————————————————

export type AlignmentView = { rowLabels: string[]; cells: (number | null)[][] };

export function toAlignmentView(peers: AlignmentPeer[]): AlignmentView {
  return {
    rowLabels: peers.map(
      (p) => str(p.display_name) ?? `${p.address.slice(0, 6)}…${p.address.slice(-4)}`,
    ),
    cells: peers.map((p) => [Math.round(p.alignment_score * 100)]),
  };
}

export async function fetchAlignment(
  api: Api,
  slug: string,
  address: string,
  limit = 12,
): Promise<AlignmentView> {
  try {
    const { data, error } = await api.GET('/v1/daos/{slug}/analytics/delegate-alignment', {
      params: { path: { slug }, query: { delegate: address, limit } },
    });
    if (error || !data) return toAlignmentView([]);
    return toAlignmentView(data.peers);
  } catch {
    return toAlignmentView([]);
  }
}
