import { describe, expect, it, vi } from 'vitest';
import { ActorMergeRepository } from './actor-merge-repository';
import {
  ActorAddressCollisionError,
  ActorAlreadyMergedError,
  ActorNotFoundForAddressError,
  SameActorMergeError,
} from './errors/actor-merge-errors';

type SelectResponse = unknown;
type UpdateResponse = { numUpdatedRows?: bigint } | undefined;

function makeDbMock(selectResponses: SelectResponse[], updateResponses: UpdateResponse[]) {
  const selectQueue = [...selectResponses];
  const updateQueue = [...updateResponses];
  const insertValues: unknown[] = [];

  const selectChain = {
    innerJoin: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    forUpdate: vi.fn().mockReturnThis(),
    execute: vi.fn().mockImplementation(async () => selectQueue.shift()),
    executeTakeFirst: vi.fn().mockImplementation(async () => selectQueue.shift()),
  };

  const updateChain = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    executeTakeFirst: vi.fn().mockImplementation(async () => updateQueue.shift()),
  };

  const insertChain = {
    values: vi.fn().mockImplementation((value: unknown) => {
      insertValues.push(value);
      return insertChain;
    }),
    execute: vi.fn().mockResolvedValue(undefined),
  };

  const selectFrom = vi.fn().mockReturnValue(selectChain);
  const updateTable = vi.fn().mockReturnValue(updateChain);
  const insertInto = vi.fn().mockReturnValue(insertChain);
  const transaction = vi.fn().mockReturnValue({
    execute: vi.fn((fn: (trx: unknown) => Promise<unknown>) =>
      fn({ selectFrom, updateTable, insertInto } as never),
    ),
  });

  return {
    selectFrom,
    updateTable,
    insertInto,
    transaction,
    selectChain,
    updateChain,
    insertChain,
    insertValues,
  };
}

describe('ActorMergeRepository', () => {
  it('rejects when the primary address is missing', async () => {
    const db = makeDbMock([[]], []);
    const repo = new ActorMergeRepository(db as never);

    await expect(
      repo.planMerge({
        primaryAddress: '0x' + '1'.repeat(40),
        secondaryAddress: '0x' + '2'.repeat(40),
      }),
    ).rejects.toBeInstanceOf(ActorNotFoundForAddressError);
  });

  it('rejects when both addresses resolve to the same actor', async () => {
    const db = makeDbMock(
      [
        [
          {
            inputAddress: '0x' + '1'.repeat(40),
            actorId: 'actor-1',
            primaryAddress: '0x' + '1'.repeat(40),
            mergedIntoActorId: null,
          },
          {
            inputAddress: '0x' + '2'.repeat(40),
            actorId: 'actor-1',
            primaryAddress: '0x' + '1'.repeat(40),
            mergedIntoActorId: null,
          },
        ],
      ],
      [],
    );
    const repo = new ActorMergeRepository(db as never);

    await expect(
      repo.planMerge({
        primaryAddress: '0x' + '1'.repeat(40),
        secondaryAddress: '0x' + '2'.repeat(40),
      }),
    ).rejects.toBeInstanceOf(SameActorMergeError);
  });

  it('rejects when either actor is already merged', async () => {
    const db = makeDbMock(
      [
        [
          {
            inputAddress: '0x' + '1'.repeat(40),
            actorId: 'actor-1',
            primaryAddress: '0x' + '1'.repeat(40),
            mergedIntoActorId: null,
          },
          {
            inputAddress: '0x' + '2'.repeat(40),
            actorId: 'actor-2',
            primaryAddress: '0x' + '2'.repeat(40),
            mergedIntoActorId: 'actor-survivor',
          },
        ],
      ],
      [],
    );
    const repo = new ActorMergeRepository(db as never);

    await expect(
      repo.planMerge({
        primaryAddress: '0x' + '1'.repeat(40),
        secondaryAddress: '0x' + '2'.repeat(40),
      }),
    ).rejects.toBeInstanceOf(ActorAlreadyMergedError);
  });

  it('rejects when survivor already owns the secondary primary address', async () => {
    const db = makeDbMock(
      [
        [
          {
            inputAddress: '0x' + '1'.repeat(40),
            actorId: 'actor-1',
            primaryAddress: '0x' + '1'.repeat(40),
            mergedIntoActorId: null,
          },
          {
            inputAddress: '0x' + '2'.repeat(40),
            actorId: 'actor-2',
            primaryAddress: '0x' + '3'.repeat(40),
            mergedIntoActorId: null,
          },
        ],
        { address: '0x' + '3'.repeat(40) },
      ],
      [],
    );
    const repo = new ActorMergeRepository(db as never);

    await expect(
      repo.planMerge({
        primaryAddress: '0x' + '1'.repeat(40),
        secondaryAddress: '0x' + '2'.repeat(40),
      }),
    ).rejects.toBeInstanceOf(ActorAddressCollisionError);
  });

  it('returns a merge plan with counts and redirect details', async () => {
    const db = makeDbMock(
      [
        [
          {
            inputAddress: '0x' + '1'.repeat(40),
            actorId: 'actor-1',
            primaryAddress: '0x' + '1'.repeat(40),
            mergedIntoActorId: null,
          },
          {
            inputAddress: '0x' + '2'.repeat(40),
            actorId: 'actor-2',
            primaryAddress: '0x' + '3'.repeat(40),
            mergedIntoActorId: null,
          },
        ],
        undefined,
        { count: 3 },
        { count: 8 },
        [{ from_address: '0x' + '4'.repeat(40), current_to_actor_id: 'actor-2' }],
      ],
      [],
    );
    const repo = new ActorMergeRepository(db as never);

    await expect(
      repo.planMerge({
        primaryAddress: '0x' + '1'.repeat(40),
        secondaryAddress: '0x' + '2'.repeat(40),
      }),
    ).resolves.toMatchObject({
      survivor: { actorId: 'actor-1', primaryAddress: '0x' + '1'.repeat(40) },
      secondary: { actorId: 'actor-2', primaryAddress: '0x' + '3'.repeat(40) },
      proposalProposerRewrites: 3,
      actorAddressRetargets: 8,
      redirectToInsert: {
        from_address: '0x' + '3'.repeat(40),
        to_actor_id: 'actor-1',
      },
    });
  });

  it('executes the merge transaction in the documented order', async () => {
    const db = makeDbMock(
      [
        [
          {
            inputAddress: '0x' + '1'.repeat(40),
            actorId: 'actor-1',
            primaryAddress: '0x' + '1'.repeat(40),
            mergedIntoActorId: null,
          },
          {
            inputAddress: '0x' + '2'.repeat(40),
            actorId: 'actor-2',
            primaryAddress: '0x' + '3'.repeat(40),
            mergedIntoActorId: null,
          },
        ],
        undefined,
        { count: 1 },
        { count: 2 },
        [{ from_address: '0x' + '4'.repeat(40), current_to_actor_id: 'actor-2' }],
      ],
      [
        { numUpdatedRows: 2n },
        { numUpdatedRows: 3n },
        { numUpdatedRows: 4n },
        { numUpdatedRows: 5n },
      ],
    );
    const repo = new ActorMergeRepository(db as never);

    const result = await repo.executeMerge({
      primaryAddress: '0x' + '1'.repeat(40),
      secondaryAddress: '0x' + '2'.repeat(40),
      mergeReason: 'same delegate',
      createdBy: 'alice',
    });

    expect(result.proposalProposerRewrites).toEqual(2);
    expect(db.updateTable).toHaveBeenNthCalledWith(1, 'proposal');
    expect(db.updateTable).toHaveBeenNthCalledWith(2, 'actor_address');
    expect(db.updateTable).toHaveBeenNthCalledWith(3, 'actor_address');
    expect(db.updateTable).toHaveBeenNthCalledWith(4, 'actor_address_redirect');
    expect(db.updateTable).toHaveBeenNthCalledWith(5, 'actor');
    expect(db.insertInto).toHaveBeenCalledWith('actor_address_redirect');
    expect(db.insertValues[0]).toMatchObject({
      from_address: '0x' + '3'.repeat(40),
      to_actor_id: 'actor-1',
      merge_reason: 'same delegate',
      created_by: 'alice',
    });
    expect(result.appliedAt).toBeInstanceOf(Date);
  });
});
