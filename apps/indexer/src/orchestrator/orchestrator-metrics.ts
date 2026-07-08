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
  /**
   * dao_source rows skipped at startup because their chain_id is not present in CHAIN_CONFIG.
   * A partial/single-protocol deployment intentionally configures a subset of chains, so an
   * un-configured chain is a scoping choice, not a fatal error. Labelled by chain_id. A non-zero
   * value in a deploy that was supposed to cover the chain is the alertable signal.
   */
  daoSourceChainUnconfigured: defineCounter({
    name: 'dao_source_chain_unconfigured',
    description:
      'dao_source rows skipped at startup because their chain_id is absent from CHAIN_CONFIG. Labelled by chain_id.',
  }),
} as const;
