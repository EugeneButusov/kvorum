import type { Logger } from '@libs/chain';
import type { DlqRepository, SourceType } from '@libs/db';
import {
  ArchiveWriter,
  createCompoundPlugins,
  type CompoundGovernorConfig,
  type CompoundGovernorPluginDeps,
} from '@sources/compound';
import type { SourcePlugin } from '@sources/core';

export type BackfillSourcePlugin = SourcePlugin<CompoundGovernorConfig>;

export function buildBackfillSourcePlugins(
  deps: CompoundGovernorPluginDeps,
): readonly BackfillSourcePlugin[] {
  return createCompoundPlugins(deps);
}

export function resolveBackfillSourcePlugin(
  sourceType: SourceType,
  plugins: readonly BackfillSourcePlugin[],
): BackfillSourcePlugin | undefined {
  return plugins.find((plugin) => plugin.sourceType === sourceType);
}

export interface BuildBackfillSourcePluginDeps {
  archiveWriter: ArchiveWriter;
  dlqRepo: DlqRepository;
  logger: Logger;
}
