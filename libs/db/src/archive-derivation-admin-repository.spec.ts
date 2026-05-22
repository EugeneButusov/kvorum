import { describe, expect, it, vi } from 'vitest';
import { ArchiveDerivationAdminRepository } from './archive-derivation-admin-repository';

function makeCountSelectChain(returnValue: unknown) {
  const executeTakeFirstOrThrow = vi.fn().mockResolvedValue(returnValue);
  const chain = {
    select: vi.fn(),
    where: vi.fn(),
    executeTakeFirstOrThrow,
  };
  chain.select.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  return { selectFrom: vi.fn().mockReturnValue(chain), chain };
}

describe('ArchiveDerivationAdminRepository', () => {
  it('counts confirmed underived rows without a starting block', async () => {
    const select = makeCountSelectChain({ count: '7' });
    const repo = new ArchiveDerivationAdminRepository({ selectFrom: select.selectFrom } as never);

    await expect(repo.countConfirmedUnderived('source-1')).resolves.toBe(7);

    expect(select.selectFrom).toHaveBeenCalledWith('archive_confirmation');
    expect(select.chain.where).toHaveBeenCalledWith('dao_source_id', '=', 'source-1');
    expect(select.chain.where).toHaveBeenCalledWith('confirmation_status', '=', 'confirmed');
    expect(select.chain.where).not.toHaveBeenCalledWith('block_number', '>=', expect.anything());
  });

  it('counts confirmed underived rows from a starting block', async () => {
    const select = makeCountSelectChain({ count: '3' });
    const repo = new ArchiveDerivationAdminRepository({ selectFrom: select.selectFrom } as never);

    await expect(repo.countConfirmedUnderived('source-1', 123n)).resolves.toBe(3);

    expect(select.chain.where).toHaveBeenCalledWith('block_number', '>=', '123');
  });
});
