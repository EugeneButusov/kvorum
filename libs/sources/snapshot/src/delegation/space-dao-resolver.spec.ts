import { describe, expect, it, vi } from 'vitest';
import { SnapshotSpaceDaoResolver } from './space-dao-resolver';

function makeDb(row: { dao_id: string } | undefined) {
  const executeTakeFirst = vi.fn().mockResolvedValue(row);
  const chain = { select: vi.fn(), where: vi.fn(), executeTakeFirst };
  chain.select.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  return { db: { selectFrom: vi.fn().mockReturnValue(chain) } as never, executeTakeFirst };
}

describe('SnapshotSpaceDaoResolver', () => {
  it('resolves a space to its snapshot dao_source dao_id', async () => {
    const { db } = makeDb({ dao_id: 'dao-lido' });
    const resolver = new SnapshotSpaceDaoResolver(db);
    expect(await resolver.resolve('lido-snapshot.eth')).toBe('dao-lido');
  });

  it('returns null for an unknown space', async () => {
    const { db } = makeDb(undefined);
    const resolver = new SnapshotSpaceDaoResolver(db);
    expect(await resolver.resolve('unknown.eth')).toBeNull();
  });

  it('caches the result (one query per space)', async () => {
    const { db, executeTakeFirst } = makeDb({ dao_id: 'dao-lido' });
    const resolver = new SnapshotSpaceDaoResolver(db);
    await resolver.resolve('lido-snapshot.eth');
    await resolver.resolve('lido-snapshot.eth');
    expect(executeTakeFirst).toHaveBeenCalledOnce();
  });
});
