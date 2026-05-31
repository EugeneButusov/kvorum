import { ARCHIVE_STAGES, ArchiveStageAdapter } from './archive-stage-adapter.js';
import type { DlqRetryAdapter } from './dlq-retry-adapter.js';
import { PgBossReEnqueueAdapter } from './pgboss-reenqueue-adapter.js';
import { ProjectionStageAdapter } from './projection-stage-adapter.js';
import { SnapshotStageAdapter } from './snapshot-stage-adapter.js';

const adapters: DlqRetryAdapter[] = [
  ...ARCHIVE_STAGES.map((stage) => new ArchiveStageAdapter(stage)),
  new ProjectionStageAdapter('vote_projection_stage'),
  new ProjectionStageAdapter('delegation_projection_stage'),
  new SnapshotStageAdapter(),
  new PgBossReEnqueueAdapter('archive_log'),
  new PgBossReEnqueueAdapter('archive_decode'),
  new PgBossReEnqueueAdapter('archive_unmapped'),
];

export const DLQ_RETRY_ADAPTERS = new Map(adapters.map((adapter) => [adapter.stage, adapter]));
