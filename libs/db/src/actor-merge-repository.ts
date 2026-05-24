import { sql, type Kysely, type Transaction } from 'kysely';
import type { PgDatabase } from './schema/pg';

export class ActorNotFoundForAddressError extends Error {
  constructor(public readonly address: string) {
    super(`actor not found for address: ${address}`);
  }
}

export class ActorAlreadyMergedError extends Error {
  constructor(
    public readonly address: string,
    public readonly mergedIntoActorId: string,
  ) {
    super(`actor for address ${address} is already merged (into ${mergedIntoActorId})`);
  }
}

export class SameActorMergeError extends Error {
  constructor(
    public readonly primaryAddress: string,
    public readonly secondaryAddress: string,
    public readonly actorId: string,
  ) {
    super(`primary and secondary addresses resolve to the same actor: ${actorId}`);
  }
}

export class ActorAddressCollisionError extends Error {
  constructor(
    public readonly address: string,
    public readonly survivorActorId: string,
  ) {
    super(
      `survivor actor ${survivorActorId} already owns address ${address}; merge would violate actor_address_pkey`,
    );
  }
}

export interface MergePlan {
  survivor: { actorId: string; primaryAddress: string };
  secondary: { actorId: string; primaryAddress: string };
  fkRewrites: {
    proposal_proposer_actor_id: number;
    vote_voter_actor_id: number;
    delegation_delegator_actor_id: number;
    delegation_delegate_actor_id: number;
    voting_power_snapshot_actor_id: number;
  };
  actorAddressRetargets: number;
  actorAddressPrimaryFlip: { address: string; willFlipIsPrimary: boolean };
  redirectsToFlatten: Array<{ from_address: string; current_to_actor_id: string }>;
  redirectToInsert: { from_address: string; to_actor_id: string };
}

export interface MergeResult extends MergePlan {
  appliedAt: Date;
}

export interface ExecuteMergeInput {
  primaryAddress: string;
  secondaryAddress: string;
  mergeReason: string;
  createdBy: string;
}

interface AddressLookupRow {
  inputAddress: string;
  actorId: string;
  primaryAddress: string;
  mergedIntoActorId: string | null;
}

interface RedirectRow {
  from_address: string;
  current_to_actor_id: string;
}

function normalizeAddress(address: string): string {
  return address.toLowerCase();
}

function toUpdatedRows(result: { numUpdatedRows?: bigint } | undefined): number {
  return Number(result?.numUpdatedRows ?? 0n);
}

async function loadAddressRows(
  db: Kysely<PgDatabase> | Transaction<PgDatabase>,
  addresses: readonly string[],
  lock: boolean,
): Promise<AddressLookupRow[]> {
  let query = db
    .selectFrom('actor as a')
    .innerJoin('actor_address as aa', 'aa.actor_id', 'a.id')
    .select([
      'aa.address as inputAddress',
      'a.id as actorId',
      'a.primary_address as primaryAddress',
      'a.merged_into_actor_id as mergedIntoActorId',
    ])
    .where('aa.address', 'in', [...addresses]);

  if (lock) {
    query = query.forUpdate();
  }

  return query.orderBy('a.id', 'asc').execute();
}

async function assertActorState(
  db: Kysely<PgDatabase> | Transaction<PgDatabase>,
  survivorActorId: string,
  secondaryPrimaryAddress: string,
): Promise<void> {
  const collision = await db
    .selectFrom('actor_address')
    .select('address')
    .where('actor_id', '=', survivorActorId)
    .where('address', '=', secondaryPrimaryAddress)
    .executeTakeFirst();

  if (collision != null) {
    throw new ActorAddressCollisionError(secondaryPrimaryAddress, survivorActorId);
  }
}

async function countRows(
  db: Kysely<PgDatabase> | Transaction<PgDatabase>,
  table: keyof Pick<
    PgDatabase,
    | 'proposal'
    | 'vote'
    | 'delegation'
    | 'voting_power_snapshot'
    | 'actor_address'
    | 'actor_address_redirect'
  >,
  column: string,
  actorId: string,
): Promise<number> {
  const row = await db
    .selectFrom(table)
    .select(sql<number>`count(*)`.as('count'))
    .where(column as never, '=', actorId as never)
    .executeTakeFirst();

  return Number((row as { count?: number | string } | undefined)?.count ?? 0);
}

function mapLookups(
  rows: AddressLookupRow[],
  addresses: readonly string[],
): Map<string, AddressLookupRow> {
  const byAddress = new Map<string, AddressLookupRow>();
  for (const row of rows) {
    byAddress.set(row.inputAddress, row);
  }

  for (const address of addresses) {
    if (!byAddress.has(address)) {
      throw new ActorNotFoundForAddressError(address);
    }
  }

  return byAddress;
}

function validateLookupPair(
  primaryAddress: string,
  secondaryAddress: string,
  primaryRow: AddressLookupRow,
  secondaryRow: AddressLookupRow,
): void {
  if (primaryRow.actorId === secondaryRow.actorId) {
    throw new SameActorMergeError(primaryAddress, secondaryAddress, primaryRow.actorId);
  }

  if (primaryRow.mergedIntoActorId != null) {
    throw new ActorAlreadyMergedError(primaryAddress, primaryRow.mergedIntoActorId);
  }

  if (secondaryRow.mergedIntoActorId != null) {
    throw new ActorAlreadyMergedError(secondaryAddress, secondaryRow.mergedIntoActorId);
  }
}

async function buildPlan(
  db: Kysely<PgDatabase> | Transaction<PgDatabase>,
  primaryAddress: string,
  secondaryAddress: string,
  lock: boolean,
): Promise<MergePlan> {
  const normalizedPrimary = normalizeAddress(primaryAddress);
  const normalizedSecondary = normalizeAddress(secondaryAddress);
  const rows = await loadAddressRows(
    db,
    normalizedPrimary === normalizedSecondary
      ? [normalizedPrimary]
      : [normalizedPrimary, normalizedSecondary],
    lock,
  );

  if (normalizedPrimary === normalizedSecondary) {
    if (rows.length === 0) {
      throw new ActorNotFoundForAddressError(normalizedPrimary);
    }

    const primaryRow = rows[0]!;
    const secondaryRow = rows[0]!;
    validateLookupPair(normalizedPrimary, normalizedSecondary, primaryRow, secondaryRow);
    await assertActorState(db, primaryRow.actorId, secondaryRow.primaryAddress);
    return {
      survivor: { actorId: primaryRow.actorId, primaryAddress: primaryRow.primaryAddress },
      secondary: { actorId: secondaryRow.actorId, primaryAddress: secondaryRow.primaryAddress },
      fkRewrites: {
        proposal_proposer_actor_id: 0,
        vote_voter_actor_id: 0,
        delegation_delegator_actor_id: 0,
        delegation_delegate_actor_id: 0,
        voting_power_snapshot_actor_id: 0,
      },
      actorAddressRetargets: 0,
      actorAddressPrimaryFlip: {
        address: secondaryRow.primaryAddress,
        willFlipIsPrimary: true,
      },
      redirectsToFlatten: [],
      redirectToInsert: {
        from_address: secondaryRow.primaryAddress,
        to_actor_id: primaryRow.actorId,
      },
    };
  }

  const lookups = mapLookups(rows, [normalizedPrimary, normalizedSecondary]);

  const primaryRow = lookups.get(normalizedPrimary)!;
  const secondaryRow = lookups.get(normalizedSecondary)!;
  validateLookupPair(normalizedPrimary, normalizedSecondary, primaryRow, secondaryRow);
  await assertActorState(db, primaryRow.actorId, secondaryRow.primaryAddress);

  const [
    proposalCount,
    voteCount,
    delegatorCount,
    delegateCount,
    snapshotCount,
    addressRetargets,
    redirectsToFlatten,
  ] = await Promise.all([
    countRows(db, 'proposal', 'proposer_actor_id', secondaryRow.actorId),
    countRows(db, 'vote', 'voter_actor_id', secondaryRow.actorId),
    countRows(db, 'delegation', 'delegator_actor_id', secondaryRow.actorId),
    countRows(db, 'delegation', 'delegate_actor_id', secondaryRow.actorId),
    countRows(db, 'voting_power_snapshot', 'actor_id', secondaryRow.actorId),
    countRows(db, 'actor_address', 'actor_id', secondaryRow.actorId),
    db
      .selectFrom('actor_address_redirect')
      .select(['from_address', 'to_actor_id as current_to_actor_id'])
      .where('to_actor_id', '=', secondaryRow.actorId)
      .execute(),
  ]);

  return {
    survivor: { actorId: primaryRow.actorId, primaryAddress: primaryRow.primaryAddress },
    secondary: { actorId: secondaryRow.actorId, primaryAddress: secondaryRow.primaryAddress },
    fkRewrites: {
      proposal_proposer_actor_id: proposalCount,
      vote_voter_actor_id: voteCount,
      delegation_delegator_actor_id: delegatorCount,
      delegation_delegate_actor_id: delegateCount,
      voting_power_snapshot_actor_id: snapshotCount,
    },
    actorAddressRetargets: addressRetargets,
    actorAddressPrimaryFlip: {
      address: secondaryRow.primaryAddress,
      willFlipIsPrimary: true,
    },
    redirectsToFlatten,
    redirectToInsert: {
      from_address: secondaryRow.primaryAddress,
      to_actor_id: primaryRow.actorId,
    },
  };
}

export class ActorMergeRepository {
  constructor(private readonly db: Kysely<PgDatabase>) {}

  async planMerge(input: { primaryAddress: string; secondaryAddress: string }): Promise<MergePlan> {
    return this.db
      .transaction()
      .execute(async (trx) => buildPlan(trx, input.primaryAddress, input.secondaryAddress, false));
  }

  async executeMerge(input: ExecuteMergeInput): Promise<MergeResult> {
    return this.db.transaction().execute(async (trx) => {
      const plan = await buildPlan(trx, input.primaryAddress, input.secondaryAddress, true);

      const survivorId = plan.survivor.actorId;
      const secondaryId = plan.secondary.actorId;

      const fkRewrites = {
        proposal_proposer_actor_id: toUpdatedRows(
          await trx
            .updateTable('proposal')
            .set({ proposer_actor_id: survivorId })
            .where('proposer_actor_id', '=', secondaryId)
            .executeTakeFirst(),
        ),
        vote_voter_actor_id: toUpdatedRows(
          await trx
            .updateTable('vote')
            .set({ voter_actor_id: survivorId })
            .where('voter_actor_id', '=', secondaryId)
            .executeTakeFirst(),
        ),
        delegation_delegator_actor_id: toUpdatedRows(
          await trx
            .updateTable('delegation')
            .set({ delegator_actor_id: survivorId })
            .where('delegator_actor_id', '=', secondaryId)
            .executeTakeFirst(),
        ),
        delegation_delegate_actor_id: toUpdatedRows(
          await trx
            .updateTable('delegation')
            .set({ delegate_actor_id: survivorId })
            .where('delegate_actor_id', '=', secondaryId)
            .executeTakeFirst(),
        ),
        voting_power_snapshot_actor_id: toUpdatedRows(
          await trx
            .updateTable('voting_power_snapshot')
            .set({ actor_id: survivorId })
            .where('actor_id', '=', secondaryId)
            .executeTakeFirst(),
        ),
      };

      const addressRetargets = toUpdatedRows(
        await trx
          .updateTable('actor_address')
          .set({ actor_id: survivorId })
          .where('actor_id', '=', secondaryId)
          .executeTakeFirst(),
      );

      await trx
        .updateTable('actor_address')
        .set({ is_primary: false })
        .where('actor_id', '=', survivorId)
        .where('address', '=', plan.secondary.primaryAddress)
        .executeTakeFirst();

      const flattened = toUpdatedRows(
        await trx
          .updateTable('actor_address_redirect')
          .set({ to_actor_id: survivorId })
          .where('to_actor_id', '=', secondaryId)
          .executeTakeFirst(),
      );

      await trx
        .insertInto('actor_address_redirect')
        .values({
          from_address: plan.redirectToInsert.from_address,
          to_actor_id: plan.redirectToInsert.to_actor_id,
          merged_at: sql<Date>`now()`,
          merge_reason: input.mergeReason,
          created_by: input.createdBy,
        })
        .execute();

      await trx
        .updateTable('actor')
        .set({ merged_into_actor_id: survivorId })
        .where('id', '=', secondaryId)
        .executeTakeFirst();

      return {
        ...plan,
        fkRewrites,
        actorAddressRetargets: addressRetargets,
        redirectsToFlatten:
          flattened > 0
            ? plan.redirectsToFlatten.map((row) => ({ ...row, current_to_actor_id: survivorId }))
            : plan.redirectsToFlatten,
        appliedAt: new Date(),
      };
    });
  }
}
