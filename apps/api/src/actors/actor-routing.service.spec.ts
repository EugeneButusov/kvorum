import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActorRoutingService } from './actor-routing.service';
import { ProblemException } from '../http/problem-exception';

describe('ActorRoutingService', () => {
  const repo = {
    findLiveActorByPrimaryAddress: vi.fn(),
    findRedirect: vi.fn(),
    findLiveActorByAnyAddress: vi.fn(),
  };

  let service: ActorRoutingService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ActorRoutingService(repo as never);
  });

  it('returns ok and short-circuits when step 1 matches', async () => {
    repo.findLiveActorByPrimaryAddress.mockResolvedValue({ id: 'actor-1' });

    await expect(
      service.resolveAddress('0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'),
    ).resolves.toEqual({
      kind: 'ok',
      actor: { id: 'actor-1' },
    });
    expect(repo.findRedirect).not.toHaveBeenCalled();
    expect(repo.findLiveActorByAnyAddress).not.toHaveBeenCalled();
  });

  it('returns redirect from step 2 and skips step 3', async () => {
    repo.findLiveActorByPrimaryAddress.mockResolvedValue(undefined);
    repo.findRedirect.mockResolvedValue({ survivor_primary_address: '0xabc' });

    await expect(
      service.resolveAddress('0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'),
    ).resolves.toEqual({
      kind: 'redirect',
      survivorPrimaryAddress: '0xabc',
    });
    expect(repo.findLiveActorByAnyAddress).not.toHaveBeenCalled();
  });

  it('returns redirect from step 3 when steps 1 and 2 miss', async () => {
    repo.findLiveActorByPrimaryAddress.mockResolvedValue(undefined);
    repo.findRedirect.mockResolvedValue(undefined);
    repo.findLiveActorByAnyAddress.mockResolvedValue({ primary_address: '0xdef' });

    await expect(
      service.resolveAddress('0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'),
    ).resolves.toEqual({
      kind: 'redirect',
      survivorPrimaryAddress: '0xdef',
    });
  });

  it('returns not-found when all steps miss', async () => {
    repo.findLiveActorByPrimaryAddress.mockResolvedValue(undefined);
    repo.findRedirect.mockResolvedValue(undefined);
    repo.findLiveActorByAnyAddress.mockResolvedValue(undefined);

    await expect(
      service.resolveAddress('0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'),
    ).resolves.toEqual({
      kind: 'not-found',
    });
  });

  it('throws validation problem for malformed addresses before DB calls', async () => {
    await expect(service.resolveAddress('vitalik.eth')).rejects.toBeInstanceOf(ProblemException);
    await expect(service.resolveAddress('0x1234')).rejects.toBeInstanceOf(ProblemException);
    expect(repo.findLiveActorByPrimaryAddress).not.toHaveBeenCalled();
    expect(repo.findRedirect).not.toHaveBeenCalled();
    expect(repo.findLiveActorByAnyAddress).not.toHaveBeenCalled();
  });
});
