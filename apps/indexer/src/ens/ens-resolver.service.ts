import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { tickEnsResolution, type EnsClient } from '@libs/chain';
import type { ActorRepository } from '@libs/db';
import { ensResolverMetrics } from './ens-resolver-metrics';

const DEFAULT_PAGE_LIMIT = 500;
const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;

@Injectable()
export class EnsResolverService {
  private readonly logger = new Logger('EnsResolverService');
  private inFlight = false;

  constructor(
    private readonly ensClient: EnsClient,
    private readonly actorRepo: ActorRepository,
  ) {}

  @Cron('0 3 * * *')
  async tick(): Promise<void> {
    await this.tickOnce();
  }

  async tickOnce(): Promise<'idle' | 'completed' | 'skipped_inflight'> {
    if (this.inFlight) {
      this.logger.warn('ens_resolver_tick_skipped_inflight');
      return 'skipped_inflight';
    }

    this.inFlight = true;
    const startedAt = Date.now();

    try {
      const result = await tickEnsResolution({
        ensClient: this.ensClient,
        actorRepo: this.actorRepo,
        opts: {
          limit: DEFAULT_PAGE_LIMIT,
          ttlSeconds: DEFAULT_TTL_SECONDS,
        },
      });

      if (result.outcome === 'idle') return 'idle';

      ensResolverMetrics.resolutions.add(result.counts.resolved, { result: 'resolved' });
      ensResolverMetrics.resolutions.add(result.counts.no_record, { result: 'no_record' });
      ensResolverMetrics.resolutions.add(result.counts.mismatch, { result: 'mismatch' });
      ensResolverMetrics.resolutions.add(result.counts.error, { result: 'error' });

      for (const item of result.perCandidate) {
        if (item.outcome.kind === 'mismatch') {
          this.logger.warn('ens_resolver_reverse_mismatch', {
            actorId: item.actorId,
            address: item.address,
            reverseName: item.outcome.reverseName,
          });
        }
        if (item.outcome.kind === 'error') {
          this.logger.warn('ens_resolver_reverse_error', {
            actorId: item.actorId,
            address: item.address,
            reason: item.outcome.reason,
          });
        }
      }

      return 'completed';
    } finally {
      ensResolverMetrics.durationSeconds.record((Date.now() - startedAt) / 1000);
      this.inFlight = false;
    }
  }
}
