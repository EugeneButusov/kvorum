import { Inject, Injectable, Logger } from '@nestjs/common';
import { ProposalRepository } from '@libs/db';
import type { ProposalState } from '@libs/db';
import { readPositiveInt } from '@libs/utils';
import { AiTriggerConfig } from './ai-trigger-config';
import { FEATURE_QUEUE } from '../queue/ai-queue-names';
import type { AiJob } from '../queue/ai-queue-names';
import { AI_QUEUE_PORT } from '../queue/ai-queue.port';
import type { AiQueuePort } from '../queue/ai-queue.port';

// SPEC §5.5: the summarizer fires as a proposal enters `pending` or `active`. Historical/terminal
// states are handled by the M5 backfill epic, not this real-time trigger.
export const TRIGGER_STATES: ProposalState[] = ['pending', 'active'];

const DEFAULT_SINGLETON_THROTTLE_SECONDS = 3600;

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
  ) {}

  async run(lookbackMs: number): Promise<number> {
    let enqueued = 0;
    if (this.config.isEnabled('proposal_summarizer')) {
      enqueued += await this.scanProposalSummaries(lookbackMs);
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
}
