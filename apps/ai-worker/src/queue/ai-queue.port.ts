import type { AiJob } from './ai-queue-names';

export const AI_QUEUE_PORT = 'AI_QUEUE_PORT';

export type AiQueueJob<T> = { readonly id: string; readonly data: T };

export interface AiSendOptions {
  singletonKey?: string;
  singletonSeconds?: number;
}

export interface AiQueuePort {
  send(queue: string, job: AiJob, opts?: AiSendOptions): Promise<string | null>;
  work<T>(
    queue: string,
    opts: { localConcurrency: number },
    handler: (jobs: ReadonlyArray<AiQueueJob<T>>) => Promise<void>,
  ): Promise<void>;
  getQueueStats(queue: string): Promise<{ queuedCount: number } | undefined>;
  /** Age in seconds of the oldest created/retry job. null if the queue is empty. */
  getOldestJobAgeSeconds(queue: string): Promise<number | null>;
}
