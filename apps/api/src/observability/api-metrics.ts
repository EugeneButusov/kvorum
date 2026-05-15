import { defineCounter } from '@libs/observability';
import { defineHistogram } from '@libs/observability';

export const apiMetrics = {
  requests: defineCounter({
    name: 'api_requests',
    description: 'API requests by method, route, status',
  }),
  latencySeconds: defineHistogram({
    name: 'api_latency_seconds',
    description: 'API request latency in seconds',
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  }),
  pepperMatch: defineCounter({
    name: 'auth_pepper_match',
    description: 'API key auth successes by pepper match source',
  }),
  authRejections: defineCounter({
    name: 'auth_rejections',
    description: 'API key authentication rejections by reason',
  }),
  rateLimitRejections: defineCounter({
    name: 'rate_limit_rejections',
    description: 'Rate limit rejections by tier and reason',
  }),
} as const;
