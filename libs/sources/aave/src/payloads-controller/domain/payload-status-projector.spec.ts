import { describe, expect, it } from 'vitest';
import { projectPayloadActions, statusTransitionFor } from './payload-status-projector';

describe('payload-status-projector', () => {
  it.each([
    ['PayloadCreated', { targetStatus: 'created', allowedFrom: ['declared'] }],
    ['PayloadQueued', { targetStatus: 'queued', allowedFrom: ['declared', 'created'] }],
    [
      'PayloadExecuted',
      { targetStatus: 'executed', allowedFrom: ['declared', 'created', 'queued'] },
    ],
    [
      'PayloadCancelled',
      { targetStatus: 'cancelled', allowedFrom: ['declared', 'created', 'queued'] },
    ],
  ] as const)('maps %s to the expected payload transition', (eventType, expected) => {
    expect(statusTransitionFor(eventType)).toEqual(expected);
  });

  it('maps payload actions onto proposal actions', () => {
    expect(
      projectPayloadActions(
        {
          payloadId: '17',
          creator: '0x' + '11'.repeat(20),
          maximumAccessLevelRequired: 1,
          actions: [
            {
              target: '0xABCDEF',
              withDelegateCall: false,
              accessLevel: 0,
              value: '340282366920938463463374607431768211456',
              signature: '',
              callData: '0x1234',
            },
            {
              target: '0x123456',
              withDelegateCall: true,
              accessLevel: 1,
              value: '42',
              signature: 'foo(uint256)',
              callData: '0xabcd',
            },
          ],
        },
        '0xa',
      ),
    ).toEqual([
      {
        targetAddress: '0xABCDEF',
        targetChainId: '0xa',
        valueWei: '340282366920938463463374607431768211456',
        functionSignature: null,
        calldata: '0x1234',
      },
      {
        targetAddress: '0x123456',
        targetChainId: '0xa',
        valueWei: '42',
        functionSignature: 'foo(uint256)',
        calldata: '0xabcd',
      },
    ]);
  });
});
