import { describe, expect, it, vi } from 'vitest';
import type { ChainContextRegistry } from '@libs/chain';
import { A_AAVE_TOKEN_ADDRESS, AAVE_TOKEN_ADDRESS, STK_AAVE_TOKEN_ADDRESS } from '../constants';
import { AaveGovernancePowerReader } from './aave-governance-power-reader';

describe('AaveGovernancePowerReader', () => {
  it('reads all three governance-power tokens at the requested block', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce('0x000000000000000000000000000000000000000000000000000000000000000a')
      .mockResolvedValueOnce('0x0000000000000000000000000000000000000000000000000000000000000014')
      .mockResolvedValueOnce('0x000000000000000000000000000000000000000000000000000000000000001e');
    const registry = {
      peek: vi.fn().mockReturnValue({ client: { send } }),
    } as unknown as ChainContextRegistry;

    const reader = new AaveGovernancePowerReader(registry);

    await expect(reader.read('0x00000000000000000000000000000000000000ab', 99n)).resolves.toEqual({
      aave: 10n,
      stkAave: 20n,
      aAave: 30n,
    });
    expect(send).toHaveBeenNthCalledWith(
      1,
      'eth_call',
      expect.arrayContaining([{ to: AAVE_TOKEN_ADDRESS, data: expect.any(String) }, '0x63']),
    );
    expect(send).toHaveBeenNthCalledWith(
      2,
      'eth_call',
      expect.arrayContaining([{ to: STK_AAVE_TOKEN_ADDRESS, data: expect.any(String) }, '0x63']),
    );
    expect(send).toHaveBeenNthCalledWith(
      3,
      'eth_call',
      expect.arrayContaining([{ to: A_AAVE_TOKEN_ADDRESS, data: expect.any(String) }, '0x63']),
    );
  });

  it('throws when the Ethereum chain context is unavailable', async () => {
    const reader = new AaveGovernancePowerReader({
      peek: vi.fn().mockReturnValue(undefined),
    } as unknown as ChainContextRegistry);

    await expect(reader.read('0x00000000000000000000000000000000000000ab', 1n)).rejects.toThrow(
      'chain context missing for 0x1',
    );
  });
});
