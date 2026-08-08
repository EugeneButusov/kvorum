import type { Kysely } from 'kysely';
import { isoSeconds, type PgDatabase, type ProposalState } from '@libs/db';
import '../persistence/schema';
import type { ProposalForumLinkConfidence } from '../persistence/schema';

const CONFIDENCE_RANK: Record<ProposalForumLinkConfidence, number> = { high: 0, medium: 1, low: 2 };

export type ForumThreadLinkedProposal = {
  source_type: string;
  source_id: string;
  title: string | null;
  confidence: ProposalForumLinkConfidence;
};

export type ForumThreadRead = {
  external_id: string;
  host: string;
  source_url: string;
  title: string | null;
  raw_content: string | null;
  post_count: number | null;
  last_activity_at: string | null;
  linked_proposals: ForumThreadLinkedProposal[];
};

/** The forum-synthesis (§5.7) input for one thread: its `raw_content`, DAO context, and the
 *  highest-confidence linked proposal's title. `linkedProposalTitle` is `null` when the thread has
 *  no links — the synthesis handler skips those. */
export type ForumThreadForSynthesis = {
  id: string;
  daoId: string;
  daoSlug: string;
  daoName: string;
  threadTitle: string | null;
  rawContent: string | null;
  linkedProposalTitle: string | null;
  // The highest-confidence linked proposal's state + voting deadline — the batch-vs-sync urgency
  // signal (SPEC §5.7: sync when voting is imminent, else batch). Null when the thread has no links.
  linkedProposalState: ProposalState | null;
  linkedProposalVotingEndsAt: Date | null;
};

/**
 * Reads a single forum thread by (DAO slug, Discourse topic id) plus the proposals it links to —
 * the standalone forum-thread page's data (§6.12). `raw_content` is the concatenated post bodies
 * (no per-post table); the AI `summary` is deferred to M5.
 */
export class ForumThreadReadRepository {
  constructor(private readonly db: Kysely<PgDatabase>) {}

  async getThread(daoSlug: string, externalId: string): Promise<ForumThreadRead | undefined> {
    const thread = await this.db
      .selectFrom('forum_thread as ft')
      .innerJoin('dao as d', 'd.id', 'ft.dao_id')
      .select([
        'ft.id',
        'ft.forum_host',
        'ft.forum_topic_id',
        'ft.title',
        'ft.raw_content',
        'ft.post_count',
        'ft.last_activity_at',
      ])
      .where('d.slug', '=', daoSlug)
      .where('ft.forum_topic_id', '=', externalId)
      .executeTakeFirst();
    if (thread === undefined) return undefined;

    const links = await this.db
      .selectFrom('proposal_forum_link as pfl')
      .innerJoin('proposal as p', 'p.id', 'pfl.proposal_id')
      .select(['p.source_type', 'p.source_id', 'p.title', 'pfl.confidence'])
      .where('pfl.forum_thread_id', '=', thread.id)
      .execute();

    return {
      external_id: thread.forum_topic_id,
      host: thread.forum_host,
      source_url: `https://${thread.forum_host}/t/${thread.forum_topic_id}`,
      title: thread.title,
      raw_content: thread.raw_content,
      post_count: thread.post_count,
      last_activity_at: isoSeconds(thread.last_activity_at),
      linked_proposals: links
        .sort((a, b) => CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence])
        .map((l) => ({
          source_type: l.source_type,
          source_id: l.source_id,
          title: l.title,
          confidence: l.confidence,
        })),
    };
  }

  /**
   * Reads a thread by its UUID for AI synthesis (§5.7): `raw_content` + DAO context + the
   * highest-confidence linked proposal's title (`high` > `medium` > `low`). Returns `undefined` when
   * the thread does not exist; `linkedProposalTitle` is `null` when it has no linked proposals.
   */
  async getThreadById(id: string): Promise<ForumThreadForSynthesis | undefined> {
    const thread = await this.db
      .selectFrom('forum_thread as ft')
      .innerJoin('dao as d', 'd.id', 'ft.dao_id')
      .select([
        'ft.id',
        'ft.dao_id',
        'ft.title',
        'ft.raw_content',
        'd.slug as dao_slug',
        'd.name as dao_name',
      ])
      .where('ft.id', '=', id)
      .executeTakeFirst();
    if (thread === undefined) return undefined;

    const links = await this.db
      .selectFrom('proposal_forum_link as pfl')
      .innerJoin('proposal as p', 'p.id', 'pfl.proposal_id')
      .select(['p.title', 'p.state', 'p.voting_ends_at', 'pfl.confidence'])
      .where('pfl.forum_thread_id', '=', id)
      .execute();

    const best = links
      .slice()
      .sort((a, b) => CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence])[0];

    return {
      id: thread.id,
      daoId: thread.dao_id,
      daoSlug: thread.dao_slug,
      daoName: thread.dao_name,
      threadTitle: thread.title,
      rawContent: thread.raw_content,
      linkedProposalTitle: best?.title ?? null,
      linkedProposalState: best?.state ?? null,
      linkedProposalVotingEndsAt: best?.voting_ends_at ?? null,
    };
  }

  /**
   * The forum synthesizer's worklist (SPEC §5.7): threads that have `raw_content` and are linked
   * (`high`/`medium` confidence) to a proposal in one of the given states (`pending`/`active`).
   * Dedup against already-generated — or non-English-skipped — syntheses is deferred to the worker's
   * `sha256(raw_content)` cache-check, so a thread stays a candidate only until its current
   * `raw_content` is processed; a new post rewrites `raw_content` and re-qualifies it.
   */
  async findSynthesisCandidates(states: ProposalState[], limit: number): Promise<{ id: string }[]> {
    if (states.length === 0) return [];
    return this.db
      .selectFrom('forum_thread as ft')
      .select('ft.id')
      .where('ft.raw_content', 'is not', null)
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('proposal_forum_link as pfl')
            .innerJoin('proposal as p', 'p.id', 'pfl.proposal_id')
            .select('pfl.id')
            .whereRef('pfl.forum_thread_id', '=', 'ft.id')
            .where('pfl.confidence', 'in', ['high', 'medium'])
            .where('p.state', 'in', states),
        ),
      )
      .orderBy('ft.last_activity_at', 'desc')
      .limit(limit)
      .execute();
  }

  /**
   * The "once on close" final-synthesis worklist (SPEC §5.7): content-bearing threads linked
   * (`high`/`medium`) to a proposal that reached a terminal state at or after `since` (the grace
   * window). Bounded by the indexed `state_updated_at`. The worker's `sha256(raw_content)` cache makes
   * the pass idempotent — one synthesis at most per closed proposal, and a no-op unless late posts
   * changed `raw_content` since the last one generated while voting.
   */
  async findRecentlyClosedSynthesisCandidates(
    states: ProposalState[],
    since: Date,
    limit: number,
  ): Promise<{ id: string }[]> {
    if (states.length === 0) return [];
    return this.db
      .selectFrom('forum_thread as ft')
      .select('ft.id')
      .where('ft.raw_content', 'is not', null)
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('proposal_forum_link as pfl')
            .innerJoin('proposal as p', 'p.id', 'pfl.proposal_id')
            .select('pfl.id')
            .whereRef('pfl.forum_thread_id', '=', 'ft.id')
            .where('pfl.confidence', 'in', ['high', 'medium'])
            .where('p.state', 'in', states)
            .where('p.state_updated_at', '>=', since),
        ),
      )
      .orderBy('ft.last_activity_at', 'desc')
      .limit(limit)
      .execute();
  }
}
