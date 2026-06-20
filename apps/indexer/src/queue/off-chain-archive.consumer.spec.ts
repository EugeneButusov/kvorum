import { vi, describe, it, expect, beforeEach } from 'vitest';
import { OffChainArchiveConsumer } from './off-chain-archive.consumer';
import type { OffChainArchiveJob } from './off-chain-archive.types';

vi.mock('@libs/chain', () => ({
  chainMetrics: { offChainArchiveConsumer: { add: vi.fn() } },
}));

const JOB: OffChainArchiveJob = {
  daoSourceId: 'src-1',
  sourceType: 'offchain_source',
  externalId: 'proposal-0xabc',
  eventType: 'ProposalCreated',
  contentHash: 'hash-v1',
  ordinal: '10',
  payload: { title: 'A' },
};

const SRC_ROW = { id: 'src-1', source_type: 'offchain_source', chain_id: 'off-chain' };

function makeDeps(over?: {
  existing?: { id: string; content_hash: string | null; version: number | null };
  src?: unknown;
  writer?: ReturnType<typeof vi.fn>;
}) {
  const writer = over?.writer ?? vi.fn().mockResolvedValue(undefined);
  const daoSourceRepo = {
    findByIdWithChain: vi.fn().mockResolvedValue('src' in (over ?? {}) ? over?.src : SRC_ROW),
  };
  const archiveEventRepo = {
    findByExternalId: vi.fn().mockResolvedValue(over?.existing),
    insert: vi.fn().mockResolvedValue({ id: 'new' }),
    reArchiveOffchain: vi.fn().mockResolvedValue(true),
  };
  const dlqRepo = { insert: vi.fn().mockResolvedValue(undefined) };
  const writers = new Map([[JOB.sourceType, writer]]);
  const consumer = new OffChainArchiveConsumer(
    {} as never,
    daoSourceRepo as never,
    archiveEventRepo as never,
    writers as never,
    dlqRepo as never,
  );
  return { consumer, writer, daoSourceRepo, archiveEventRepo, dlqRepo };
}

describe('OffChainArchiveConsumer.consume', () => {
  beforeEach(() => vi.clearAllMocks());

  it('inserts a new row with version=1 and writes CH first', async () => {
    const d = makeDeps({ existing: undefined });
    await d.consumer.consume(JOB);

    expect(d.writer).toHaveBeenCalledWith(
      expect.objectContaining({ sourceType: 'offchain_source' }),
      expect.objectContaining({ externalId: 'proposal-0xabc', version: 1, contentHash: 'hash-v1' }),
    );
    expect(d.archiveEventRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        external_id: 'proposal-0xabc',
        content_hash: 'hash-v1',
        version: 1,
        event_type: 'ProposalCreated',
        derivation_ordinal: '10',
      }),
    );
    expect(d.archiveEventRepo.reArchiveOffchain).not.toHaveBeenCalled();
  });

  it('re-archives with version+1 when content_hash changed', async () => {
    const d = makeDeps({ existing: { id: 'row-1', content_hash: 'hash-v1', version: 1 } });
    await d.consumer.consume({ ...JOB, contentHash: 'hash-v2' });

    expect(d.writer).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ version: 2 }),
    );
    expect(d.archiveEventRepo.reArchiveOffchain).toHaveBeenCalledWith(
      expect.objectContaining({ externalId: 'proposal-0xabc' }),
      expect.objectContaining({ contentHash: 'hash-v2', version: 2, ordinal: '10' }),
    );
    expect(d.archiveEventRepo.insert).not.toHaveBeenCalled();
  });

  it('skips when content_hash is unchanged (no CH write, no PG write)', async () => {
    const d = makeDeps({ existing: { id: 'row-1', content_hash: 'hash-v1', version: 1 } });
    await d.consumer.consume(JOB);

    expect(d.writer).not.toHaveBeenCalled();
    expect(d.archiveEventRepo.insert).not.toHaveBeenCalled();
    expect(d.archiveEventRepo.reArchiveOffchain).not.toHaveBeenCalled();
  });

  it('dead-letters (ack) when the dao_source is unknown', async () => {
    const d = makeDeps({ src: undefined });
    await d.consumer.consume(JOB);

    expect(d.dlqRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'off_chain_archive',
        archive_source_type: 'offchain_source',
      }),
    );
    expect(d.writer).not.toHaveBeenCalled();
  });

  it('dead-letters (ack) when no off-chain writer is registered for the source_type', async () => {
    const d = makeDeps();
    await d.consumer.consume({ ...JOB, sourceType: 'unregistered_source' });

    expect(d.dlqRepo.insert).toHaveBeenCalled();
    expect(d.writer).not.toHaveBeenCalled();
  });

  it('rethrows a transient writer error (→ retry → deadLetter)', async () => {
    const writer = vi.fn().mockRejectedValue(new Error('CH down'));
    const d = makeDeps({ existing: undefined, writer });
    await expect(d.consumer.consume(JOB)).rejects.toThrow('CH down');
  });
});
