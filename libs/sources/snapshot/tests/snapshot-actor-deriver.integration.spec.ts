import { afterAll, describe, expect, it } from 'vitest';
import { chDb } from '@libs/db';
import type { OffchainArchiveRow } from '@libs/db';
import '../src/persistence/schema';
import { SnapshotActorAddressDeriver } from '../src/domain/actor-address-deriver';
import { makeSnapshotOffChainArchiveWriter } from '../src/ingestion/archive-writer';
import { SnapshotArchivePayloadRepository } from '../src/persistence/archive-payload-repository';

const CH_URL = process.env['CLICKHOUSE_URL'];
const describeIf = CH_URL ? describe : describe.skip;

const DAO_SOURCE_ID = 'a0000000-0000-4000-8000-000000000099';

function voteRow(externalId: string): OffchainArchiveRow {
  return {
    id: externalId,
    source_type: 'snapshot',
    dao_source_id: DAO_SOURCE_ID,
    chain_id: 'off-chain',
    external_id: externalId,
    derivation_ordinal: '1',
    event_type: 'SnapshotVoteCast',
    received_at: new Date(),
    derivation_attempt_count: 0,
  };
}

afterAll(async () => {
  await chDb.destroy();
});

// Proves the AD3 deriver reads a real archived Snapshot vote slice from `archive_event_snapshot`
// and surfaces the voter. The sweep→markActorResolved→derivable gate itself is unchanged from AD2's
// proven proposer path (covered by the indexer off-chain sweep test).
describeIf('SnapshotActorAddressDeriver (integration)', () => {
  const repo = new SnapshotArchivePayloadRepository(chDb);
  const deriver = new SnapshotActorAddressDeriver(repo);
  const writeCh = makeSnapshotOffChainArchiveWriter({ chDb });

  it('reads an archived vote payload and extracts its voter', async () => {
    const externalId = `vote:0xv-${Date.now()}`;
    const voter = '0x' + 'ab'.repeat(20);
    await writeCh(
      {
        daoSourceId: DAO_SOURCE_ID,
        sourceType: 'snapshot',
        chainId: 'off-chain',
        sourceLabel: 'snapshot',
      },
      {
        externalId,
        contentHash: 'h1',
        ordinal: '1',
        version: 1,
        payload: { id: externalId.slice('vote:'.length), voter, choice: 1, created: 1 },
      },
    );

    const payloads = await deriver.fetchPayloads([voteRow(externalId)]);
    const mine = payloads.find((p) => p.external_id === externalId);
    expect(mine?.event_type).toBe('SnapshotVoteCast');

    const candidates = deriver.extractAddresses('SnapshotVoteCast', mine!.payload);
    expect(candidates).toEqual([{ address: voter, role: 'voter_event' }]);
  });
});
