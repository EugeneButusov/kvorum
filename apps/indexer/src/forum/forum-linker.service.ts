import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import {
  ForumLinkRepository,
  computeProposalLinks,
  forumMetrics,
  type LinkCandidateThread,
} from '@sources/forum';
import { readIntervalMs, readPositiveInt } from '../app/env-helpers';

const FORUM_LINK_INTERVAL_MS = readIntervalMs('FORUM_LINK_INTERVAL_MS', 15_000);
const DEFAULT_BATCH_SIZE = 200;
const THREAD_CAP = readPositiveInt('FORUM_LINK_THREAD_CAP', 5000);

/**
 * Proposal-driven forum linker (SPEC §3.7 high + medium). Each tick takes a bounded batch of
 * not-yet-scanned proposals of forum-enabled DAOs, loads each involved DAO's threads once, computes
 * deterministic links (description-URL → high, community-curated title → medium), inserts them
 * idempotently, and stamps the proposals scanned. The thread-derivation applier re-queues a DAO's
 * unlinked proposals when a new thread lands, so both arrival orders converge.
 */
@Injectable()
export class ForumLinkerService {
  private readonly logger = new Logger('ForumLinker');
  private inFlight = false;

  constructor(private readonly links: ForumLinkRepository) {}

  @Interval(FORUM_LINK_INTERVAL_MS)
  async tick(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      const batchSize = readPositiveInt('FORUM_LINK_BATCH_SIZE', DEFAULT_BATCH_SIZE);
      const proposals = await this.links.findUnscannedProposals(batchSize);
      if (proposals.length === 0) return;

      const threadsByDao = new Map<string, LinkCandidateThread[]>();
      for (const daoId of new Set(proposals.map((p) => p.daoId))) {
        threadsByDao.set(daoId, await this.links.findThreadsByDao(daoId, THREAD_CAP));
      }

      let created = 0;
      for (const proposal of proposals) {
        const threads = threadsByDao.get(proposal.daoId) ?? [];
        const links = computeProposalLinks(
          { id: proposal.id, title: proposal.title, description: proposal.description },
          threads,
        );
        for (const link of links) {
          await this.links.insertLink(link);
          forumMetrics.linksCreated.add(1, { confidence: link.confidence });
          created += 1;
        }
      }

      await this.links.markProposalsScanned(proposals.map((p) => p.id));
      forumMetrics.proposalsLinkScanned.add(proposals.length);
      if (created > 0) {
        this.logger.log('forum_links_created', { scanned: proposals.length, created });
      }
    } catch (err) {
      this.logger.error('forum_linker_tick_failed', { error: String(err) });
    } finally {
      this.inFlight = false;
    }
  }
}
