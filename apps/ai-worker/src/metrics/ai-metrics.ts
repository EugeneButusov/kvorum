import { defineGauge } from '@libs/observability';

// Service prefix (OTEL_SERVICE_NAME='ai-worker' → 'ai_worker_') is prepended by defineGauge.
export const aiMetrics = {
  jobQueueDepth: defineGauge({
    name: 'job_queue_depth',
    description: 'Count of created+retry AI jobs per queue',
  }),
  jobQueueAgeSeconds: defineGauge({
    name: 'job_queue_age_seconds',
    description: 'Age in seconds of the oldest pending AI job per queue (0 if empty)',
  }),
};
