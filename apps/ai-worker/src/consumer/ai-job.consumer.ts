import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import { readPositiveInt } from '@libs/utils';
import { AiFeatureHandlerRegistry } from './ai-feature-handler.registry';
import { FEATURE_QUEUE } from '../queue/ai-queue-names';
import type { AiJob } from '../queue/ai-queue-names';
import { AI_QUEUE_PORT } from '../queue/ai-queue.port';
import type { AiQueuePort } from '../queue/ai-queue.port';

@Injectable()
export class AiJobConsumer implements OnApplicationBootstrap {
  private readonly logger = new Logger('AiJobConsumer');

  constructor(
    @Inject(AI_QUEUE_PORT) private readonly queue: AiQueuePort,
    private readonly registry: AiFeatureHandlerRegistry,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const concurrency = readPositiveInt('AI_JOB_CONCURRENCY', 1);
    for (const { main } of Object.values(FEATURE_QUEUE)) {
      await this.queue.work<AiJob>(main, { localConcurrency: concurrency }, async (jobs) => {
        for (const job of jobs) {
          await this.handle(job.data);
        }
      });
    }
    this.logger.log('ai_job_consumer_registered');
  }

  private async handle(job: AiJob): Promise<void> {
    const handler = this.registry.get(job.feature);
    if (handler === undefined) {
      // Graceful skip (ack): a feature whose handler ships in M5-2 must not flood the DLQ.
      this.logger.warn('ai_job_no_handler_skip', {
        feature: job.feature,
        entityRef: job.entityRef,
      });
      return;
    }
    await handler.handle(job);
  }
}
