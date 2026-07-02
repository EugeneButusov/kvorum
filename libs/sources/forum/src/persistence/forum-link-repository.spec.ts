import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from 'kysely';
import { describe, expect, it } from 'vitest';
import type { PgDatabase } from '@libs/db';
import { ForumLinkRepository } from './forum-link-repository';

// A real Kysely wired to DummyDriver: query builders run (and compile against the schema types), but
// nothing executes — reads come back empty. This exercises the full builder code (incl. the eb/oc
// callbacks) without a live database; behavioural matching is covered by the matcher/linker specs.
function repo(): ForumLinkRepository {
  const db = new Kysely<PgDatabase>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (d) => new PostgresIntrospector(d),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });
  return new ForumLinkRepository(db);
}

describe('ForumLinkRepository', () => {
  it('builds findUnscannedProposals without error (empty under DummyDriver)', async () => {
    await expect(repo().findUnscannedProposals(50)).resolves.toEqual([]);
  });

  it('markProposalsScanned short-circuits on an empty id list', async () => {
    await expect(repo().markProposalsScanned([])).resolves.toBeUndefined();
  });

  it('markProposalsScanned builds an update for a non-empty id list', async () => {
    await expect(repo().markProposalsScanned(['p1', 'p2'])).resolves.toBeUndefined();
  });

  it('builds findThreadsByDao without error', async () => {
    await expect(repo().findThreadsByDao('dao-1', 1000)).resolves.toEqual([]);
  });

  it('resetScanForUnlinkedProposals builds the NOT EXISTS update and returns a count', async () => {
    await expect(repo().resetScanForUnlinkedProposals('dao-1')).resolves.toBe(0);
  });

  it('insertLink builds an idempotent (ON CONFLICT DO NOTHING) insert', async () => {
    await expect(
      repo().insertLink({
        proposalId: 'p1',
        forumThreadId: 't1',
        confidence: 'high',
        linkMethod: 'description_url',
      }),
    ).resolves.toBeUndefined();
  });
});
