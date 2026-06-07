import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { LogEvent } from '@libs/chain';
import { DecodeError } from '@sources/core';
import { decodeAavePayloadsControllerLog } from './decoder';
import { AAVE_PAYLOADS_CONTROLLER_INTERFACE } from './events';

function loadFixture(name: string): { topics: string[]; data: string } {
  const path = join(__dirname, '..', '..', '..', 'tests', 'fixtures', 'logs', `${name}.json`);
  return JSON.parse(readFileSync(path, 'utf8')) as { topics: string[]; data: string };
}

function makeLog(overrides: Partial<LogEvent> = {}): LogEvent {
  return {
    sourceType: 'aave_payloads_controller',
    chainId: '0x1',
    blockNumber: 23000000n,
    blockHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
    txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    txIndex: 0,
    logIndex: 0,
    address: '0xdabad81af85554e9ae636395611c58f7ec1aaec5',
    topics: [],
    data: '0x',
    ...overrides,
  };
}

describe('decodeAavePayloadsControllerLog', () => {
  it('decodes PayloadCreated with structured actions', () => {
    const fixture = loadFixture('payload-created');
    expect(decodeAavePayloadsControllerLog(makeLog(fixture), 'aave_payloads_controller')).toEqual({
      type: 'PayloadCreated',
      payload: {
        payloadId: '80',
        creator: '0xe3fd707583932a99513a5c65c8463de769f5dadf',
        maximumAccessLevelRequired: 1,
        actions: [
          {
            target: '0xc09aa853780cf5c2265560d2f0d9208522c71d36',
            withDelegateCall: true,
            accessLevel: 1,
            value: '0',
            signature: 'execute()',
            callData: '0x',
          },
        ],
      },
    });
  });

  it('decodes PayloadQueued', () => {
    const fixture = loadFixture('payload-queued');
    expect(decodeAavePayloadsControllerLog(makeLog(fixture), 'aave_payloads_controller')).toEqual({
      type: 'PayloadQueued',
      payload: { payloadId: '40' },
    });
  });

  it('decodes PayloadExecuted', () => {
    const fixture = loadFixture('payload-executed');
    expect(decodeAavePayloadsControllerLog(makeLog(fixture), 'aave_payloads_controller')).toEqual({
      type: 'PayloadExecuted',
      payload: { payloadId: '147' },
    });
  });

  it('decodes PayloadCancelled', () => {
    const fixture = loadFixture('payload-cancelled');
    expect(decodeAavePayloadsControllerLog(makeLog(fixture), 'aave_payloads_controller')).toEqual({
      type: 'PayloadCancelled',
      payload: { payloadId: '274' },
    });
  });

  it('throws parse_failed on malformed data', () => {
    const fixture = loadFixture('payload-executed');
    expect(() =>
      decodeAavePayloadsControllerLog(
        makeLog({ topics: fixture.topics, data: '0x1234' }),
        'aave_payloads_controller',
      ),
    ).toThrow(DecodeError);
    try {
      decodeAavePayloadsControllerLog(
        makeLog({ topics: fixture.topics, data: '0x1234' }),
        'aave_payloads_controller',
      );
    } catch (err) {
      expect((err as DecodeError).reason).toBe('parse_failed');
    }
  });

  it('throws unknown_topic on foreign topic', () => {
    const encoded = AAVE_PAYLOADS_CONTROLLER_INTERFACE.encodeEventLog(
      AAVE_PAYLOADS_CONTROLLER_INTERFACE.getEvent('PayloadExecuted')!,
      [999n],
    );
    vi.spyOn(AAVE_PAYLOADS_CONTROLLER_INTERFACE, 'parseLog').mockReturnValueOnce({
      name: 'Transfer',
      fragment: { topicHash: '0x' + 'ff'.repeat(32) },
    } as never);

    expect(() =>
      decodeAavePayloadsControllerLog(
        makeLog({ topics: encoded.topics as string[], data: encoded.data }),
        'aave_payloads_controller',
      ),
    ).toThrow(DecodeError);
  });

  it('throws unknown_topic when parseLog returns null', () => {
    vi.spyOn(AAVE_PAYLOADS_CONTROLLER_INTERFACE, 'parseLog').mockReturnValueOnce(null);

    expect(() =>
      decodeAavePayloadsControllerLog(
        makeLog(loadFixture('payload-executed')),
        'aave_payloads_controller',
      ),
    ).toThrow(DecodeError);
  });
});
