import { defineCounter } from '@libs/observability';

export const apiMetrics = {
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
