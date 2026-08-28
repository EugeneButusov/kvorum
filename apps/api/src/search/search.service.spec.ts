import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SearchReadRepository } from './search-read-repository';
import { SearchService } from './search.service';

function mockRepo(): SearchReadRepository {
  return {
    searchProposals: vi.fn().mockResolvedValue([]),
    searchDaos: vi.fn().mockResolvedValue([]),
    searchActors: vi.fn().mockResolvedValue([]),
    lookupActorsByAddress: vi.fn().mockResolvedValue([]),
  } as unknown as SearchReadRepository;
}

describe('SearchService', () => {
  let repo: ReturnType<typeof mockRepo>;
  let service: SearchService;

  beforeEach(() => {
    repo = mockRepo();
    service = new SearchService(repo);
  });

  it('calls FTS methods for a text query', async () => {
    await service.search('compound', undefined, undefined);

    expect(repo.searchProposals).toHaveBeenCalledWith('compound', 5);
    expect(repo.searchDaos).toHaveBeenCalledWith('compound', 5);
    expect(repo.searchActors).toHaveBeenCalledWith('compound', 5);
    expect(repo.lookupActorsByAddress).not.toHaveBeenCalled();
  });

  it('detects a full hex address and uses address lookup for actors', async () => {
    const address = '0x' + 'ab'.repeat(20);
    await service.search(address, undefined, undefined);

    expect(repo.lookupActorsByAddress).toHaveBeenCalledWith(address, true, 5);
    expect(repo.searchActors).not.toHaveBeenCalled();
    expect(repo.searchProposals).toHaveBeenCalled();
    expect(repo.searchDaos).toHaveBeenCalled();
  });

  it('detects a partial hex address (4+ hex chars after 0x)', async () => {
    await service.search('0x1234', undefined, undefined);

    expect(repo.lookupActorsByAddress).toHaveBeenCalledWith('0x1234', false, 5);
    expect(repo.searchActors).not.toHaveBeenCalled();
  });

  it('does not treat short hex strings as addresses (< 4 hex chars after 0x)', async () => {
    await service.search('0xab', undefined, undefined);

    expect(repo.lookupActorsByAddress).not.toHaveBeenCalled();
    expect(repo.searchActors).toHaveBeenCalledWith('0xab', 5);
  });

  it('respects type=dao and only queries DAOs', async () => {
    await service.search('aave', 'dao', undefined);

    expect(repo.searchDaos).toHaveBeenCalledWith('aave', 5);
    expect(repo.searchProposals).not.toHaveBeenCalled();
    expect(repo.searchActors).not.toHaveBeenCalled();
    expect(repo.lookupActorsByAddress).not.toHaveBeenCalled();
  });

  it('respects type=proposal', async () => {
    await service.search('governance', 'proposal', undefined);

    expect(repo.searchProposals).toHaveBeenCalledWith('governance', 5);
    expect(repo.searchDaos).not.toHaveBeenCalled();
    expect(repo.searchActors).not.toHaveBeenCalled();
  });

  it('respects type=actor', async () => {
    await service.search('vitalik', 'actor', undefined);

    expect(repo.searchActors).toHaveBeenCalledWith('vitalik', 5);
    expect(repo.searchProposals).not.toHaveBeenCalled();
    expect(repo.searchDaos).not.toHaveBeenCalled();
  });

  it('uses address lookup when type=actor and query is an address', async () => {
    const address = '0x' + 'ff'.repeat(20);
    await service.search(address, 'actor', undefined);

    expect(repo.lookupActorsByAddress).toHaveBeenCalledWith(address, true, 5);
    expect(repo.searchActors).not.toHaveBeenCalled();
  });

  it('throws on empty query', async () => {
    await expect(service.search('', undefined, undefined)).rejects.toThrow();
  });

  it('throws on whitespace-only query', async () => {
    await expect(service.search('   ', undefined, undefined)).rejects.toThrow();
  });

  it('caps limit to 25', async () => {
    await service.search('test', undefined, 50);
    expect(repo.searchProposals).toHaveBeenCalledWith('test', 25);
  });

  it('floors limit to 1', async () => {
    await service.search('test', undefined, 0);
    expect(repo.searchProposals).toHaveBeenCalledWith('test', 1);
  });

  it('defaults limit to 5', async () => {
    await service.search('test', undefined, undefined);
    expect(repo.searchProposals).toHaveBeenCalledWith('test', 5);
  });

  it('returns empty arrays for omitted entity types', async () => {
    const result = await service.search('aave', 'dao', undefined);
    expect(result.proposals).toEqual([]);
    expect(result.actors).toEqual([]);
  });

  it('truncates query longer than 200 chars', async () => {
    const longQuery = 'a'.repeat(250);
    await service.search(longQuery, 'dao', undefined);

    expect(repo.searchDaos).toHaveBeenCalledWith('a'.repeat(200), 5);
  });
});
