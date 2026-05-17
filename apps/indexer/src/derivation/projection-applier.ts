import type { ArchiveDerivationRow } from '@libs/db';

export const PROJECTION_APPLIERS = Symbol('PROJECTION_APPLIERS');

export interface ProjectionApplier {
  readonly sourceTypes: readonly string[];
  applyBatch(rows: readonly ArchiveDerivationRow[]): Promise<void>;
}
