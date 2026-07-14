import { Module } from '@nestjs/common';
import { ForumApiModule } from '@nest/forum';

/**
 * Aggregates every source's read-API contribution (controllers) so apps/api registers them without
 * naming individual source packages — the source-blind conduit for API surfaces, mirroring how
 * SourcesModule aggregates plugins and PROPOSAL_METADATA_DTOS aggregates metadata DTOs. A new source
 * that exposes a standalone read endpoint joins its `*ApiModule` here.
 */
@Module({ imports: [ForumApiModule] })
export class SourceApiModule {}
