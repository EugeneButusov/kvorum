export { SourcesModule } from './sources.module';
export { buildDriverMetrics, stateReconcilerMetrics } from './reconcile-metrics';
// Re-export the plugin collection token + type so source-blind consumers (apps/api)
// can inject them without importing @sources/* (eslint-banned under apps/api/src).
export { SOURCE_PLUGINS } from '@sources/core';
export type { SourcePlugin } from '@sources/core';
