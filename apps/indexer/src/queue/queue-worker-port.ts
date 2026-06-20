export const QUEUE_WORKER_PORT = 'QUEUE_WORKER_PORT';

export type QueueJob<T> = { readonly id: string; readonly data: T };

export interface QueueWorkerPort {
  work<T>(
    queue: string,
    opts: { localConcurrency: number },
    handler: (jobs: ReadonlyArray<QueueJob<T>>) => Promise<void>,
  ): Promise<void>;
  getQueueStats(queue: string): Promise<{ queuedCount: number } | undefined>;
  /** Age in seconds of the oldest created/retry job. null if the queue is empty. */
  getOldestJobAgeSeconds(queue: string): Promise<number | null>;
}
