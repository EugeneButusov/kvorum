import { Inject, Injectable, Logger } from '@nestjs/common';
import { ProposalMismatchScanRepository } from '@libs/ai';
import { ProposalRepository } from '@libs/db';
import type { ProposalState } from '@libs/db';
import { readPositiveInt } from '@libs/utils';
import { ForumThreadReadRepository } from '@sources/forum';
import { AiTriggerConfig } from './ai-trigger-config';
import { AiBudgetState } from '../budget/ai-budget-state';
import { FEATURE_QUEUE } from '../queue/ai-queue-names';
import type { AiJob } from '../queue/ai-queue-names';
import { AI_QUEUE_PORT } from '../queue/ai-queue.port';
import type { AiQueuePort } from '../queue/ai-queue.port';

// SPEC §5.5: the summarizer fires as a proposal enters `pending` or `active`. Historical/terminal
// states are handled by the M5 backfill epic, not this real-time trigger.
export const TRIGGER_STATES: ProposalState[] = ['pending', 'active'];
// SPEC §5.6: the mismatch detector runs synchronously on `active` proposals (operators want it fast);
// batch/backfill over other states is the M5 backfill epic.
export const MISMATCH_STATES: ProposalState[] = ['active'];
// SPEC §5.7: the forum synthesizer runs on threads linked to `pending`/`active` proposals.
export const FORUM_STATES: ProposalState[] = ['pending', 'active'];
// SPEC §5.8: embed a proposal once it has entered ANY state above `pending` (canceled-before-voting
// still gets embedded for the historical record). Backfill of pre-lookback history is the M5-7 epic.
export const EMBED_STATES: ProposalState[] = [
  'active',
  'succeeded',
  'defeated',
  'queued',
  'executed',
  'canceled',
  'expired',
  'vetoed',
];

const DEFAULT_SINGLETON_THROTTLE_SECONDS = 3600;
const MAX_MISMATCH_CANDIDATES = 100;
const MAX_FORUM_CANDIDATES = 100;

/** Decoupled poll-based trigger bridge. For each enabled feature, finds eligible entities and
 *  enqueues one job per entity (singletonKey + singletonSeconds throttle). #433 wires only the
 *  proposal-state → ai_summarize trigger; all-actions-decoded / thread-linked are M5-2. */
@Injectable()
export class AiTriggerScanner {
  private readonly logger = new Logger('AiTriggerScanner');

  constructor(
    @Inject(AI_QUEUE_PORT) private readonly queue: AiQueuePort,
    private readonly config: AiTriggerConfig,
    private readonly proposals: ProposalRepository,
    private readonly budgetState: AiBudgetState,
    private readonly mismatchScan: ProposalMismatchScanRepository,
    private readonly forumThreads: ForumThreadReadRepository,
  ) {}

  async run(lookbackMs: number): Promise<number> {
    let enqueued = 0;
    if (
      this.config.isEnabled('proposal_summarizer') &&
      !this.budgetState.isDisabled('proposal_summarizer')
    ) {
      enqueued += await this.scanProposalSummaries(lookbackMs);
    }
    if (
      this.config.isEnabled('mismatch_detector') &&
      !this.budgetState.isDisabled('mismatch_detector')
    ) {
      enqueued += await this.scanProposalMismatches();
    }
    if (
      this.config.isEnabled('forum_synthesizer') &&
      !this.budgetState.isDisabled('forum_synthesizer')
    ) {
      enqueued += await this.scanForumThreads();
    }
    if (this.config.isEnabled('embedding') && !this.budgetState.isDisabled('embedding')) {
      enqueued += await this.scanProposalEmbeddings(lookbackMs);
    }
    return enqueued;
  }

  private async scanProposalSummaries(lookbackMs: number): Promise<number> {
    const since = new Date(Date.now() - lookbackMs);
    const rows = await this.proposals.findRecentlyTransitioned(TRIGGER_STATES, since);
    const throttle = readPositiveInt(
      'AI_SINGLETON_THROTTLE_SECONDS',
      DEFAULT_SINGLETON_THROTTLE_SECONDS,
    );

    let count = 0;
    for (const row of rows) {
      const entityRef = `proposal:${row.id}`;
      const job: AiJob = { feature: 'proposal_summarizer', entityRef };
      const id = await this.queue.send(FEATURE_QUEUE.proposal_summarizer.main, job, {
        singletonKey: `proposal_summarizer:${entityRef}`,
        singletonSeconds: throttle,
      });
      if (id !== null) count += 1;
    }
    if (count > 0)
      this.logger.log('ai_trigger_enqueued', { feature: 'proposal_summarizer', count });
    return count;
  }

  /** SPEC §5.6: enqueue a mismatch job for each binding proposal (in the sync states) whose actions
   *  are all decoded. "Requeue on decode completion" is just the next scan picking it up once
   *  decoding finishes; the content-hash cache dedups re-scans. */
  private async scanProposalMismatches(): Promise<number> {
    const rows = await this.mismatchScan.findCandidates(MISMATCH_STATES, MAX_MISMATCH_CANDIDATES);
    const throttle = readPositiveInt(
      'AI_SINGLETON_THROTTLE_SECONDS',
      DEFAULT_SINGLETON_THROTTLE_SECONDS,
    );

    let count = 0;
    for (const row of rows) {
      const entityRef = `proposal:${row.id}`;
      const job: AiJob = { feature: 'mismatch_detector', entityRef };
      const id = await this.queue.send(FEATURE_QUEUE.mismatch_detector.main, job, {
        singletonKey: `mismatch_detector:${entityRef}`,
        singletonSeconds: throttle,
      });
      if (id !== null) count += 1;
    }
    if (count > 0) this.logger.log('ai_trigger_enqueued', { feature: 'mismatch_detector', count });
    return count;
  }

  /** SPEC §5.7: enqueue a synthesis job for each content-bearing thread linked (high/medium) to a
   *  pending/active proposal. The handler dedups via the `sha256(raw_content)` cache (so a new post
   *  re-qualifies the thread) and skips non-English threads with a `_meta` marker; batch vs. real-time
   *  is just the scan cadence (4h sweep vs. 60s). */
  private async scanForumThreads(): Promise<number> {
    const rows = await this.forumThreads.findSynthesisCandidates(
      FORUM_STATES,
      MAX_FORUM_CANDIDATES,
    );
    const throttle = readPositiveInt(
      'AI_SINGLETON_THROTTLE_SECONDS',
      DEFAULT_SINGLETON_THROTTLE_SECONDS,
    );

    let count = 0;
    for (const row of rows) {
      const entityRef = `forum_thread:${row.id}`;
      const job: AiJob = { feature: 'forum_synthesizer', entityRef };
      const id = await this.queue.send(FEATURE_QUEUE.forum_synthesizer.main, job, {
        singletonKey: `forum_synthesizer:${entityRef}`,
        singletonSeconds: throttle,
      });
      if (id !== null) count += 1;
    }
    if (count > 0) this.logger.log('ai_trigger_enqueued', { feature: 'forum_synthesizer', count });
    return count;
  }

  /** SPEC §5.8: embed each proposal recently transitioned to a state above `pending`. The handler's
   *  `(proposal_id, embedding_version)` + `input_hash` cache-check dedups re-enqueues, so a permissive
   *  recently-transitioned scan is safe (unchanged input ⇒ cache hit, no API call). */
  private async scanProposalEmbeddings(lookbackMs: number): Promise<number> {
    const since = new Date(Date.now() - lookbackMs);
    const rows = await this.proposals.findRecentlyTransitioned(EMBED_STATES, since);
    const throttle = readPositiveInt(
      'AI_SINGLETON_THROTTLE_SECONDS',
      DEFAULT_SINGLETON_THROTTLE_SECONDS,
    );

    let count = 0;
    for (const row of rows) {
      const entityRef = `proposal:${row.id}`;
      const job: AiJob = { feature: 'embedding', entityRef };
      const id = await this.queue.send(FEATURE_QUEUE.embedding.main, job, {
        singletonKey: `embedding:${entityRef}`,
        singletonSeconds: throttle,
      });
      if (id !== null) count += 1;
    }
    if (count > 0) this.logger.log('ai_trigger_enqueued', { feature: 'embedding', count });
    return count;
  }
}
