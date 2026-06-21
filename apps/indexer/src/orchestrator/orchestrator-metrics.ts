import { defineCounter } from '@libs/observability';

export const orchestratorMetrics = {
  /**
   * dao_source rows skipped at startup because no plugin is registered for their source_type
   * (ADR-0073: seed-ahead tolerance). Labelled by source_type. A non-zero value in a deploy that
   * was supposed to register a plugin is a release-gate signal, not steady-state noise.
   */
  daoSourceUnregistered: defineCounter({
    name: 'dao_source_unregistered',
    description:
      'dao_source rows skipped at startup because no plugin is registered for their source_type (ADR-0073). Labelled by source_type.',
  }),
} as const;
