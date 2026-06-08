import { describe, expect, it } from 'vitest';
import {
  PAYLOAD_STATE_INTERFACE,
  decodePayloadStateResult,
  encodeGetPayloadStateCall,
  mapPayloadStateCode,
} from './payload-state';

describe('payload-state ABI', () => {
  it('encodes getPayloadById calls and decodes the state field from the 11-field struct', () => {
    expect(encodeGetPayloadStateCall('17')).toBe(
      PAYLOAD_STATE_INTERFACE.encodeFunctionData('getPayloadById', [17n]),
    );

    const data = PAYLOAD_STATE_INTERFACE.encodeFunctionResult('getPayloadById', [
      [
        '0x' + '11'.repeat(20),
        7n,
        5n,
        1n,
        2n,
        3n,
        4n,
        5n,
        6n,
        7n,
        [['0x' + '22'.repeat(20), false, 1n, 99n, 'execute()', '0x1234']],
      ],
    ]);

    expect(decodePayloadStateResult(data)).toBe(5);
    expect(mapPayloadStateCode(0)).toBe('none');
    expect(mapPayloadStateCode(1)).toBe('created');
    expect(mapPayloadStateCode(2)).toBe('queued');
    expect(mapPayloadStateCode(3)).toBe('executed');
    expect(mapPayloadStateCode(4)).toBe('cancelled');
    expect(mapPayloadStateCode(5)).toBe('expired');
  });

  it('throws on unknown payload state codes', () => {
    expect(() => mapPayloadStateCode(9)).toThrow('unknown Aave payload state code: 9');
  });
});
