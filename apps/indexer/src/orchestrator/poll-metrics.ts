import { defineCounter, defineGauge } from '@libs/observability';

export const pollMetrics = {
  /** Tick outcomes. result=ok|error|timeout. */
  pollTick: defineCounter({
    name: 'poll_tick',
    description: 'Poll-source tick outcomes per source_type. result=ok|error|timeout',
  }),
  /** Items forwarded to QueueProducerPort per source_type. */
  pollItemsEnqueued: defineCounter({
    name: 'poll_items_enqueued',
    description: 'Items forwarded to the enqueue port per source_type.',
  }),
  /** Unix timestamp of last successful tick; staleness alarm on age. */
  pollLastSuccess: defineGauge({
    name: 'poll_last_success_unixtime',
    description:
      'Unix timestamp (seconds) of the last successful poll tick per source_type. Alert when now() - value exceeds threshold.',
  }),
} as const;
