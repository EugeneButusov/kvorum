import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ArchiveDerivationRow } from '@libs/db';
import { ArchiveDerivationRepository, ProposalRepository } from '@libs/db';
import {
  AavePayloadStitchApplier,
  type AavePayloadStitchApplierDeps,
} from './payload-stitch-applier';
import { AaveProposalRepository } from '../../persistence/aave-proposal-repository';
import type { AavePayloadsControllerArchivePayloadRow } from '../persistence/archive-payload-repository';

const BASE_ROW: ArchiveDerivationRow = {
  id: 'archive-1',
  source_type: 'aave_payloads_controller',
  dao_source_id: 'source-1',
  chain_id: '0xa',
  block_number: '100',
  block_hash: '0xblock',
  tx_hash: '0xtx',
  log_index: 1,
  event_type: 'PayloadCreated',
  received_at: new Date('2026-01-01T00:00:00Z'),
  derivation_attempt_count: 0,
};

const BASE_DECLARED = {
  id: 'declared-1',
  proposal_id: 'proposal-1',
  payload_index: 2,
  status: 'declared',
} as const;

const CREATED_PAYLOAD: AavePayloadsControllerArchivePayloadRow = {
  chain_id: '0xa',
  tx_hash: '0xtx',
  log_index: 1,
  block_hash: '0xblock',
  event_type: 'PayloadCreated',
  payload: JSON.stringify({
    payloadId: '17',
    creator: '0x' + '11'.repeat(20),
    maximumAccessLevelRequired: 1,
    actions: [
      {
        target: '0xABCDEF',
        withDelegateCall: false,
        accessLevel: 0,
        value: '10',
        signature: '',
        callData: '0x1234',
      },
    ],
  }),
  received_at: new Date('2026-01-01T00:00:00Z'),
};

interface MutableApplier {
  blockTimestamps: {
    fetchBatch: ReturnType<typeof vi.fn>;
    resultKey: (blockNumber: string, blockHash: string) => string;
  };
}

function mutable(applier: AavePayloadStitchApplier): MutableApplier {
  return applier as unknown as MutableApplier;
}

function buildApplier(options?: {
  payloads?: readonly AavePayloadsControllerArchivePayloadRow[];
  declared?: typeof BASE_DECLARED | undefined;
  chainCtx?: unknown;
}) {
  const archive: AavePayloadStitchApplierDeps['archive'] = {
    incrementAttemptCount: vi.fn().mockResolvedValue(undefined),
  } as never;
  const dlq: AavePayloadStitchApplierDeps['dlq'] = {
    insert: vi.fn().mockResolvedValue(undefined),
  } as never;
  const payloads: AavePayloadStitchApplierDeps['payloads'] = {
    fetchPayloads: vi.fn().mockResolvedValue(options?.payloads ?? [CREATED_PAYLOAD]),
  } as never;
  const proposals: AavePayloadStitchApplierDeps['proposals'] = {} as never;
  const declared =
    options != null && Object.prototype.hasOwnProperty.call(options, 'declared')
      ? options.declared
      : BASE_DECLARED;
  const aaveProposals: AavePayloadStitchApplierDeps['aaveProposals'] = {
    findPayloadsControllerAddress: vi.fn().mockResolvedValue('0x' + '22'.repeat(20)),
    findDeclaredPayload: vi.fn().mockResolvedValue(declared),
  } as never;
  const metrics = {
    batchLookupSeconds: vi.fn(),
    stitchPendingSeconds: vi.fn(),
    processed: vi.fn(),
  };
  const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };
  const registry: AavePayloadStitchApplierDeps['registry'] = {
    peek: vi
      .fn()
      .mockReturnValue(options?.chainCtx ?? { client: {}, chainCfg: { chainId: '0xa' } }),
  } as never;
  const pgDb = {
    transaction: vi.fn().mockReturnValue({
      execute: async (callback: (tx: unknown) => Promise<unknown>) => callback({}),
    }),
  } as never;

  const applier = new AavePayloadStitchApplier({
    pgDb,
    archive,
    dlq,
    payloads,
    proposals,
    aaveProposals,
    registry,
    metrics,
    logger: logger as never,
  });
  mutable(applier).blockTimestamps = {
    fetchBatch: vi
      .fn()
      .mockResolvedValue(new Map([['100:0xblock', new Date('2026-01-01T00:01:40Z')]])),
    resultKey: (blockNumber: string, blockHash: string) => `${blockNumber}:${blockHash}`,
  };

  return {
    applier,
    archive,
    dlq,
    metrics,
    logger,
    aaveProposals,
  };
}

describe('AavePayloadStitchApplier', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('projects PayloadCreated into payload-local proposal actions and marks the row derived', async () => {
    vi.spyOn(AaveProposalRepository.prototype, 'advancePayloadStatus').mockResolvedValue(1);
    vi.spyOn(ProposalRepository.prototype, 'insertActions').mockResolvedValue(1);
    vi.spyOn(ArchiveDerivationRepository.prototype, 'markDerived').mockResolvedValue(undefined);

    const { applier, metrics, aaveProposals } = buildApplier();

    await applier.applyBatch([BASE_ROW]);

    expect(aaveProposals.findDeclaredPayload).toHaveBeenCalledWith({
      targetChainId: '0xa',
      payloadsControllerAddress: '0x' + '22'.repeat(20),
      payloadId: '17',
    });
    expect(AaveProposalRepository.prototype.advancePayloadStatus).toHaveBeenCalledWith({
      id: 'declared-1',
      targetStatus: 'created',
      allowedFrom: ['declared'],
      executedAtDestination: undefined,
    });
    expect(ProposalRepository.prototype.insertActions).toHaveBeenCalledWith(
      'proposal-1',
      [
        {
          targetAddress: '0xABCDEF',
          targetChainId: '0xa',
          valueWei: '10',
          functionSignature: null,
          calldata: '0x1234',
        },
      ],
      2,
    );
    expect(ArchiveDerivationRepository.prototype.markDerived).toHaveBeenCalledWith('archive-1');
    expect(metrics.processed).toHaveBeenCalledWith({
      event_type: 'PayloadCreated',
      outcome: 'derived',
      reason: null,
    });
    expect(metrics.stitchPendingSeconds).toHaveBeenCalledWith(0, {
      target_chain_id: '0xa',
      event_type: 'PayloadCreated',
    });
  });

  it('sets executed_at_destination from the target-chain block timestamp', async () => {
    vi.spyOn(AaveProposalRepository.prototype, 'advancePayloadStatus').mockResolvedValue(1);
    vi.spyOn(ArchiveDerivationRepository.prototype, 'markDerived').mockResolvedValue(undefined);

    const executedRow = { ...BASE_ROW, event_type: 'PayloadExecuted' as const };
    const executedPayload = {
      ...CREATED_PAYLOAD,
      event_type: 'PayloadExecuted' as const,
      payload: JSON.stringify({ payloadId: '17' }),
    };
    const { applier } = buildApplier({ payloads: [executedPayload] });

    await applier.applyBatch([executedRow]);

    expect(AaveProposalRepository.prototype.advancePayloadStatus).toHaveBeenCalledWith({
      id: 'declared-1',
      targetStatus: 'executed',
      allowedFrom: ['declared', 'created', 'queued'],
      executedAtDestination: new Date('2026-01-01T00:01:40Z'),
    });
  });

  it('holds rows indefinitely when the declared payload row is absent', async () => {
    const row = { ...BASE_ROW, received_at: new Date(Date.now() - 60_000) };
    const { applier, archive, dlq, metrics, logger } = buildApplier({
      declared: undefined,
    });

    await applier.applyBatch([row]);

    expect(archive.incrementAttemptCount).not.toHaveBeenCalled();
    expect(dlq.insert).not.toHaveBeenCalled();
    expect(metrics.processed).toHaveBeenCalledWith({
      event_type: 'PayloadCreated',
      outcome: 'held',
      reason: 'no_declared_payload',
    });
    expect(metrics.stitchPendingSeconds).toHaveBeenCalledWith(
      expect.any(Number),
      expect.objectContaining({ target_chain_id: '0xa', event_type: 'PayloadCreated' }),
    );
    expect(
      (metrics.stitchPendingSeconds as ReturnType<typeof vi.fn>).mock.calls[0]?.[0],
    ).toBeGreaterThan(0);
    expect(logger.info).toHaveBeenCalledWith(
      'aave_payload_stitch_held',
      expect.objectContaining({ chain_id: '0xa', event_type: 'PayloadCreated' }),
    );
  });

  it('classifies late PayloadCreated rows as derived when actions are inserted after status is already terminal', async () => {
    vi.spyOn(AaveProposalRepository.prototype, 'advancePayloadStatus').mockResolvedValue(0);
    vi.spyOn(ProposalRepository.prototype, 'insertActions').mockResolvedValue(1);
    vi.spyOn(ArchiveDerivationRepository.prototype, 'markDerived').mockResolvedValue(undefined);

    const { applier, metrics } = buildApplier();

    await applier.applyBatch([BASE_ROW]);

    expect(metrics.processed).toHaveBeenCalledWith({
      event_type: 'PayloadCreated',
      outcome: 'derived',
      reason: null,
    });
  });

  it('marks out-of-order queued-after-executed rows as skipped_idempotent', async () => {
    vi.spyOn(AaveProposalRepository.prototype, 'advancePayloadStatus').mockResolvedValue(0);
    vi.spyOn(ArchiveDerivationRepository.prototype, 'markDerived').mockResolvedValue(undefined);

    const queuedRow = { ...BASE_ROW, event_type: 'PayloadQueued' as const };
    const queuedPayload = {
      ...CREATED_PAYLOAD,
      event_type: 'PayloadQueued' as const,
      payload: JSON.stringify({ payloadId: '17' }),
    };
    const { applier, metrics } = buildApplier({ payloads: [queuedPayload] });

    await applier.applyBatch([queuedRow]);

    expect(metrics.processed).toHaveBeenCalledWith({
      event_type: 'PayloadQueued',
      outcome: 'skipped_idempotent',
      reason: null,
    });
  });

  it('fails rows when the archive payload lookup misses', async () => {
    const { applier, archive, metrics } = buildApplier({ payloads: [] });

    await applier.applyBatch([BASE_ROW]);

    expect(archive.incrementAttemptCount).toHaveBeenCalledWith('archive-1');
    expect(metrics.processed).toHaveBeenCalledWith({
      event_type: 'PayloadCreated',
      outcome: 'failed',
      reason: 'payload_missing',
    });
  });

  it('fails PayloadExecuted when chain context is missing', async () => {
    const executedRow = { ...BASE_ROW, event_type: 'PayloadExecuted' as const };
    const executedPayload = {
      ...CREATED_PAYLOAD,
      event_type: 'PayloadExecuted' as const,
      payload: JSON.stringify({ payloadId: '17' }),
    };
    const { applier, archive, metrics } = buildApplier({
      payloads: [executedPayload],
      chainCtx: undefined,
    });
    mutable(applier).blockTimestamps = {
      fetchBatch: vi.fn(),
      resultKey: (blockNumber: string, blockHash: string) => `${blockNumber}:${blockHash}`,
    };

    await applier.applyBatch([executedRow]);

    expect(archive.incrementAttemptCount).toHaveBeenCalledWith('archive-1');
    expect(metrics.processed).toHaveBeenCalledWith({
      event_type: 'PayloadExecuted',
      outcome: 'failed',
      reason: 'block_timestamp_unavailable',
    });
  });

  it('dlqs hard failures after the threshold', async () => {
    const row = { ...BASE_ROW, derivation_attempt_count: 4 };
    const { applier, archive, dlq, metrics } = buildApplier();
    vi.spyOn(AaveProposalRepository.prototype, 'advancePayloadStatus').mockRejectedValue(
      new Error('boom'),
    );

    await applier.applyBatch([row]);

    expect(archive.incrementAttemptCount).toHaveBeenCalledWith('archive-1');
    expect(dlq.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'aave_payload_projection_stage',
        retries: 5,
      }),
    );
    expect(metrics.processed).toHaveBeenCalledWith({
      event_type: 'PayloadCreated',
      outcome: 'failed',
      reason: 'projection_apply_error',
    });
  });
});
