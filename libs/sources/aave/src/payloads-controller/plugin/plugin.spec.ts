import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { silentLogger } from '@libs/chain';
import type { DlqRepository } from '@libs/db';
import type { SourceContext } from '@sources/core';
import { createAavePayloadsControllerPlugin } from './plugin';
import { AAVE_PAYLOADS_CONTROLLER_TOPICS } from '../abi/events';
import { AavePayloadsControllerArchiveWriter } from '../ingestion/archive-writer';
import * as ingesterListener from '../ingestion/ingester-listener';

const CTX: SourceContext = {
  daoSourceId: '00000000-0000-0000-0000-000000000001',
  sourceType: 'aave_payloads_controller',
  chainId: '0x1',
  sourceLabel: 'aave_payloads_controller',
};

const mockArchiveWriter = {
  writeCore: vi.fn().mockResolvedValue(undefined),
} as unknown as AavePayloadsControllerArchiveWriter;
const mockDlqRepo = { insert: vi.fn() } as unknown as DlqRepository;

function loadFixture(name: string) {
  return JSON.parse(
    readFileSync(
      join(__dirname, '..', '..', '..', 'tests', 'fixtures', 'logs', `${name}.json`),
      'utf8',
    ),
  ) as {
    chainId: string;
    address: string;
    blockNumber: string;
    blockHash: string;
    txHash: string;
    logIndex: number;
    topics: string[];
    data: string;
  };
}

function makePlugin() {
  return createAavePayloadsControllerPlugin({
    archiveWriter: mockArchiveWriter,
    dlqRepo: mockDlqRepo,
    logger: silentLogger,
  });
}

describe('createAavePayloadsControllerPlugin', () => {
  it('uses sourceType aave_payloads_controller and supports the seeded chains', () => {
    const plugin = makePlugin();
    expect(plugin.sourceType).toBe('aave_payloads_controller');
    expect(plugin.supportedChainIds).toEqual([
      '0x1',
      '0x89',
      '0xa86a',
      '0xa4b1',
      '0xa',
      '0x2105',
      '0x64',
      '0x38',
      '0x82750',
      '0xe708',
      '0xa4ec',
      '0x92',
      '0x440',
      '0x144',
    ]);
  });

  it('accepts payloads_controller_address and rejects governor_address', () => {
    const plugin = makePlugin();
    expect(
      plugin.parseConfig({
        payloads_controller_address: '0xdAbad81aF85554E9ae636395611C58F7eC1aAEc5',
      }),
    ).toEqual({
      payloads_controller_address: '0xdAbad81aF85554E9ae636395611C58F7eC1aAEc5',
    });
    expect(() =>
      plugin.parseConfig({
        governor_address: '0xdAbad81aF85554E9ae636395611C58F7eC1aAEc5',
      }),
    ).toThrow();
  });

  it('buildIngestSpec lowercases the address and registers all 4 topics', () => {
    const plugin = makePlugin();
    const spec = plugin.buildIngestSpec(CTX, {
      payloads_controller_address: '0xdAbad81aF85554E9ae636395611C58F7eC1aAEc5',
    });

    expect(spec.kind).toBe('evm-event-poller');
    expect(spec.filter.address).toBe('0xdabad81af85554e9ae636395611c58f7ec1aaec5');
    expect(spec.filter.topics).toEqual([
      [
        AAVE_PAYLOADS_CONTROLLER_TOPICS.PayloadCreated,
        AAVE_PAYLOADS_CONTROLLER_TOPICS.PayloadQueued,
        AAVE_PAYLOADS_CONTROLLER_TOPICS.PayloadExecuted,
        AAVE_PAYLOADS_CONTROLLER_TOPICS.PayloadCancelled,
      ],
    ]);
  });

  it('buildBackfillRuntime uses the ingester listener with onWriteFailure=throw', () => {
    const spy = vi.spyOn(ingesterListener, 'makeAavePayloadsControllerIngesterListener');
    const plugin = makePlugin();
    const runtime = plugin.buildBackfillRuntime(CTX, {
      payloads_controller_address: '0xdAbad81aF85554E9ae636395611C58F7eC1aAEc5',
    });

    runtime.listenerFactory();
    expect(spy).toHaveBeenCalledWith(expect.any(Object), { onWriteFailure: 'throw' });
  });

  it('buildArchiveConsumer decodes RawLogJob and calls writeCore', async () => {
    const plugin = makePlugin();
    const consume = plugin.buildArchiveConsumer!();
    const fixture = loadFixture('payload-created');

    await consume(CTX, {
      chainId: fixture.chainId,
      blockNumber: fixture.blockNumber,
      blockHash: fixture.blockHash,
      txHash: fixture.txHash,
      logIndex: fixture.logIndex,
      address: fixture.address,
      topics: fixture.topics,
      data: fixture.data,
    });

    expect((mockArchiveWriter.writeCore as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]).toEqual({
      type: 'PayloadCreated',
      payload: {
        payloadId: '321',
        creator: '0x1234567890abcdef1234567890abcdef12345678',
        maximumAccessLevelRequired: 2,
        actions: [
          {
            target: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
            withDelegateCall: true,
            accessLevel: 2,
            value: '9007199254741115',
            signature: 'execute(uint256,address)',
            callData: '0x1234abcd',
          },
          {
            target: '0x00000000000000000000000000000000000000aa',
            withDelegateCall: false,
            accessLevel: 1,
            value: '0',
            signature: 'sweep()',
            callData: '0x',
          },
        ],
      },
    });
  });
});
