import { z } from 'zod';
import type { Logger } from '@libs/chain';
import type { DlqRepository, SourceType } from '@libs/db';
import type { SourcePlugin } from '@sources/core';
import { ArchiveWriter } from './archive-writer';
import { COMPOUND_EVENT_TOPICS } from './events';
import { makeIngesterListener } from './ingester-listener';

const DaoSourceConfigSchema = z.object({
  governor_address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
});

export type CompoundGovernorConfig = z.infer<typeof DaoSourceConfigSchema>;

export interface CompoundGovernorPluginDeps {
  archiveWriter: ArchiveWriter;
  dlqRepo: DlqRepository;
  logger: Logger;
}

function createPlugin(
  sourceType: SourceType,
  deps: CompoundGovernorPluginDeps,
): SourcePlugin<CompoundGovernorConfig> {
  return {
    sourceType,
    parseConfig: (raw) => DaoSourceConfigSchema.parse(raw),
    buildIngestSpec: (ctx, cfg) => ({
      kind: 'evm-event-poller',
      filter: {
        address: cfg.governor_address.toLowerCase(),
        topics: [Object.values(COMPOUND_EVENT_TOPICS)],
      },
      listener: makeIngesterListener({
        archiveWriter: deps.archiveWriter,
        context: ctx,
        logger: deps.logger,
        dlqRepo: deps.dlqRepo,
      }),
    }),
  };
}

export function createCompoundGovernorPlugin(
  deps: CompoundGovernorPluginDeps,
): SourcePlugin<CompoundGovernorConfig> {
  return createPlugin('compound_governor', deps);
}

export function createCompoundGovernorAlphaPlugin(
  deps: CompoundGovernorPluginDeps,
): SourcePlugin<CompoundGovernorConfig> {
  return createPlugin('compound_governor_alpha', deps);
}
