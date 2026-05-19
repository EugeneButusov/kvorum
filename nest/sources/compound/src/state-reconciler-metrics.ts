import { defineCounter, defineGauge, defineHistogram } from '@libs/observability';
import type { ReconcileDriverMetrics } from '@sources/compound';

export const stateReconcilerMetrics = {
  stateReconcile: defineCounter({
    name: 'state_reconcile',
    description: 'Proposal state reconciliation outcomes by source type and outcome',
  }),
  stateReconcileRpcFailEscalated: defineCounter({
    name: 'state_reconcile_rpc_fail_escalated',
    description: 'Escalated repeated rpc_failed outcomes for proposal reconciliation',
  }),
  stateReconcileBacklog: defineGauge({
    name: 'state_reconcile_backlog',
    description: 'Candidate backlog size observed per reconciliation tick',
  }),
  stateReconcileBatchSaturated: defineCounter({
    name: 'state_reconcile_batch_saturated',
    description: 'Number of ticks where reconciliation batch hit configured limit',
  }),
  stateReconcileRpcCalls: defineCounter({
    name: 'state_reconcile_rpc_calls',
    description: 'RPC calls made by proposal state reconciler, split by method',
  }),
  stateReconcileTickDurationSeconds: defineHistogram({
    name: 'state_reconcile_tick_duration_seconds',
    description: 'Wall-clock duration of one state reconciliation tick',
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
  }),
} as const;

export function buildDriverMetrics(): ReconcileDriverMetrics {
  return {
    recordBacklog: (size) => stateReconcilerMetrics.stateReconcileBacklog.record(size),
    recordBatchSaturated: () => stateReconcilerMetrics.stateReconcileBatchSaturated.add(1),
    recordOutcome: (attrs) => stateReconcilerMetrics.stateReconcile.add(1, attrs),
    recordRpcFailEscalated: (sourceType) =>
      stateReconcilerMetrics.stateReconcileRpcFailEscalated.add(1, { source_type: sourceType }),
    recordTickDurationSeconds: (seconds) =>
      stateReconcilerMetrics.stateReconcileTickDurationSeconds.record(seconds),
  };
}
