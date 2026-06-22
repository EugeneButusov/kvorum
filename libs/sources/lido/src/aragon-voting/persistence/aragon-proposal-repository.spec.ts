import { describe, expect, it, vi } from 'vitest';
import { AragonProposalRepository } from './aragon-proposal-repository';

describe('AragonProposalRepository', () => {
  it('insertMetadata inserts with ON CONFLICT (proposal_id) DO NOTHING', async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const onConflict = vi.fn((cb: (oc: unknown) => unknown) => {
      cb({ column: () => ({ doNothing: () => undefined }) });
      return { execute };
    });
    const values = vi.fn().mockReturnValue({ onConflict });
    const insertInto = vi.fn().mockReturnValue({ values });
    const repo = new AragonProposalRepository({ insertInto } as never);

    await repo.insertMetadata({ proposal_id: 'p1', app_address: '0xabc' } as never);

    expect(insertInto).toHaveBeenCalledWith('aragon_proposal_metadata');
    expect(values).toHaveBeenCalledWith({ proposal_id: 'p1', app_address: '0xabc' });
    expect(onConflict).toHaveBeenCalled();
    expect(execute).toHaveBeenCalled();
  });

  it('setExecutedAt updates executed_at for the proposal', async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const where = vi.fn().mockReturnValue({ execute });
    const set = vi.fn().mockReturnValue({ where });
    const updateTable = vi.fn().mockReturnValue({ set });
    const repo = new AragonProposalRepository({ updateTable } as never);

    const ts = new Date('2026-02-02T00:00:00Z');
    await repo.setExecutedAt('p1', ts);

    expect(updateTable).toHaveBeenCalledWith('aragon_proposal_metadata');
    expect(set).toHaveBeenCalledWith({ executed_at: ts });
    expect(where).toHaveBeenCalledWith('proposal_id', '=', 'p1');
    expect(execute).toHaveBeenCalled();
  });

  it('findVotingAddress reads the voting_address from dao_source config', async () => {
    const executeTakeFirst = vi.fn().mockResolvedValue({ voting_address: '0xdef' });
    const where = vi.fn().mockReturnValue({ executeTakeFirst });
    const select = vi.fn().mockReturnValue({ where });
    const selectFrom = vi.fn().mockReturnValue({ select });
    const repo = new AragonProposalRepository({ selectFrom } as never);

    expect(await repo.findVotingAddress('s1')).toBe('0xdef');
    expect(selectFrom).toHaveBeenCalledWith('dao_source');
    expect(where).toHaveBeenCalledWith('id', '=', 's1');
  });

  it('findVotingAddress returns undefined when config has no address', async () => {
    const executeTakeFirst = vi.fn().mockResolvedValue({ voting_address: null });
    const where = vi.fn().mockReturnValue({ executeTakeFirst });
    const select = vi.fn().mockReturnValue({ where });
    const selectFrom = vi.fn().mockReturnValue({ select });
    const repo = new AragonProposalRepository({ selectFrom } as never);

    expect(await repo.findVotingAddress('s1')).toBeUndefined();
  });
});
