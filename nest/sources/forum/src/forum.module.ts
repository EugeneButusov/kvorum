import { Logger, Module } from '@nestjs/common';
import { ArchiveDerivationRepository, DaoSourceRepository, chDb, pgDb } from '@libs/db';
import { FORUM_LINK_READER, type ForumLinkReader } from '@libs/domain';
import type { SourcePlugin } from '@sources/core';
import {
  ForumArchivePayloadRepository,
  ForumLinkReadRepository,
  ForumLinkRepository,
  ForumThreadActorAddressDeriver,
  ForumThreadProjectionApplier,
  createForumPlugin,
  makeForumReadExtension,
} from '@sources/forum';
import { toChainLogger } from '@nest/chain';

export const FORUM_SOURCE_PLUGIN = 'FORUM_SOURCE_PLUGIN';

function optionalInt(name: string): number | undefined {
  const raw = process.env[name];
  return raw !== undefined ? Number(raw) : undefined;
}

// Off-chain source: one `discourse_forum` plugin covering every seeded DAO forum (lido/aave/compound).
// Registers the thread projection applier and the no-op actor deriver (forum posts have no on-chain
// actors — the deriver only advances rows past the actor-resolution gate). Registering here starts
// live crawling + derivation on boot (gated by INDEXER_LIVE_POLLER_ENABLED).
@Module({
  providers: [
    {
      provide: FORUM_SOURCE_PLUGIN,
      useFactory: (): SourcePlugin => {
        const payloads = new ForumArchivePayloadRepository(chDb);

        const threadApplier = new ForumThreadProjectionApplier({
          pgDb,
          payloads,
          archive: new ArchiveDerivationRepository(pgDb),
          daoSources: new DaoSourceRepository(pgDb),
          // On a new thread, re-queue the DAO's unlinked proposals for the linker sweep (best-effort;
          // the sweep itself runs indexer-only via ForumLinkerModule).
          linkRepo: new ForumLinkRepository(pgDb),
          logger: toChainLogger(new Logger('ForumThreadProjection')),
        });
        const actorAddressDeriver = new ForumThreadActorAddressDeriver();

        return {
          name: 'forum',
          ingesters: [
            createForumPlugin({
              chDb,
              clientOptions: { userAgent: process.env['FORUM_USER_AGENT'] },
              intervalMs: optionalInt('FORUM_POLL_INTERVAL_MS'),
              maxThreadsPerTick: optionalInt('FORUM_MAX_THREADS_PER_TICK'),
              reconcileIntervalMs: optionalInt('FORUM_RECONCILE_INTERVAL_MS'),
            }),
          ],
          derivers: [threadApplier, actorAddressDeriver],
          readExtension: makeForumReadExtension(),
        };
      },
    },
    {
      // Cross-source forum-link surface for the API proposal-detail path. Provided here (the
      // forum lib owns the tables) and re-exported via SourcesModule so apps/api can inject it
      // source-blind through the @libs/domain token.
      provide: FORUM_LINK_READER,
      useFactory: (): ForumLinkReader => new ForumLinkReadRepository(pgDb),
    },
  ],
  exports: [FORUM_SOURCE_PLUGIN, FORUM_LINK_READER],
})
export class ForumSourceModule {}
