import { AdminAuditRepository } from './admin-audit-repository';
import { pgDb } from './client';

const describeWithDb = process.env['DATABASE_URL'] != null ? describe : describe.skip;

class RollbackSignal extends Error {}

afterAll(async () => {
  await pgDb.destroy();
});

describeWithDb('AdminAuditRepository (integration)', () => {
  it('start() inserts a row and returns a UUID-shaped id', async () => {
    await expect(
      pgDb.transaction().execute(async (trx) => {
        const repo = new AdminAuditRepository(trx as never);
        const id = await repo.start({
          command: 'keys create',
          args: { userId: 'u1' },
          executor: 'alice',
          executorKind: 'env',
        });

        expect(typeof id).toBe('string');
        expect(id.length).toBeGreaterThan(0);

        const row = await trx
          .selectFrom('admin_audit')
          .selectAll()
          .where('id', '=', id)
          .executeTakeFirst();

        expect(row).toBeDefined();
        expect(row?.command).toBe('keys create');
        expect(row?.executor).toBe('alice');
        expect(row?.executor_kind).toBe('env');
        expect(row?.outcome).toBeNull();
        expect(row?.completed_at).toBeNull();

        throw new RollbackSignal();
      }),
    ).rejects.toThrow(RollbackSignal);
  });

  it('complete() with success sets outcome and completed_at, clears error', async () => {
    await expect(
      pgDb.transaction().execute(async (trx) => {
        const repo = new AdminAuditRepository(trx as never);
        const id = await repo.start({
          command: 'dao add',
          args: { slug: 'test' },
          executor: 'bob',
          executorKind: 'sudo',
        });

        await repo.complete({ id, outcome: 'success' });

        const row = await trx
          .selectFrom('admin_audit')
          .selectAll()
          .where('id', '=', id)
          .executeTakeFirstOrThrow();

        expect(row.outcome).toBe('success');
        expect(row.completed_at).not.toBeNull();
        expect(row.error).toBeNull();

        throw new RollbackSignal();
      }),
    ).rejects.toThrow(RollbackSignal);
  });

  it('complete() with failure persists a redacted error object', async () => {
    await expect(
      pgDb.transaction().execute(async (trx) => {
        const repo = new AdminAuditRepository(trx as never);
        const id = await repo.start({
          command: 'dlq accept',
          args: { dlqId: 'd1', reason: 'manual' },
          executor: 'carol',
          executorKind: 'ssh',
        });

        await repo.complete({
          id,
          outcome: 'failure',
          error: { name: 'Error', message: 'connection refused' },
        });

        const row = await trx
          .selectFrom('admin_audit')
          .selectAll()
          .where('id', '=', id)
          .executeTakeFirstOrThrow();

        expect(row.outcome).toBe('failure');
        expect(row.error).toEqual({ name: 'Error', message: 'connection refused' });

        throw new RollbackSignal();
      }),
    ).rejects.toThrow(RollbackSignal);
  });

  it('listRecent() returns rows ordered by started_at desc and surfaces null-outcome rows', async () => {
    await expect(
      pgDb.transaction().execute(async (trx) => {
        const repo = new AdminAuditRepository(trx as never);

        const id1 = await repo.start({
          command: 'backfill start',
          args: { daoSourceId: 's1' },
          executor: 'dave',
          executorKind: 'env',
        });
        const id2 = await repo.start({
          command: 'keys revoke',
          args: { keyId: 'k1' },
          executor: 'dave',
          executorKind: 'env',
        });
        await repo.complete({ id: id2, outcome: 'success' });

        const rows = await repo.listRecent(10);
        const ids = rows.map((r) => r.id);

        expect(ids).toContain(id1);
        expect(ids).toContain(id2);

        // id1 (orphan/in-progress) surfaces with null outcome
        const orphan = rows.find((r) => r.id === id1);
        expect(orphan?.outcome).toBeNull();
        expect(orphan?.completed_at).toBeNull();

        throw new RollbackSignal();
      }),
    ).rejects.toThrow(RollbackSignal);
  });

  it('listRecent() respects the limit parameter', async () => {
    await expect(
      pgDb.transaction().execute(async (trx) => {
        const repo = new AdminAuditRepository(trx as never);
        for (let i = 0; i < 5; i++) {
          await repo.start({
            command: `cmd-${i}`,
            args: {},
            executor: 'e',
            executorKind: 'unknown',
          });
        }
        const rows = await repo.listRecent(3);
        expect(rows.length).toBeLessThanOrEqual(3);
        throw new RollbackSignal();
      }),
    ).rejects.toThrow(RollbackSignal);
  });
});
