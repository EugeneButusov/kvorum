import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@libs/db', () => {
  class Repo {
    constructor(_db?: unknown, _db2?: unknown) {}
  }

  return {
    pgDb: {},
    chDb: {},
    ActorRepository: Repo,
    ActorRoutingReadRepository: Repo,
    AnalyticsReadRepository: Repo,
    ArchiveDerivationRepository: Repo,
    ArchiveEventRepository: Repo,
    ApiKeyRepository: Repo,
    DaoSourceRepository: Repo,
    DaoReadRepository: Repo,
    DelegationRepository: Repo,
    DlqRepository: Repo,
    DelegationReadRepository: Repo,
    ProposalRepository: Repo,
    ProposalReadRepository: Repo,
    VoteEventsProjectionReadRepository: Repo,
    VoteEventsProjectionWriter: Repo,
    VoteReadRepository: Repo,
    VotingPowerSnapshotProjectionWriter: Repo,
    VotingPowerSnapshotRunRepository: Repo,
  };
});

import { ProposalReadRepository, VoteReadRepository } from '@libs/db';
import { DbModule } from './db.module';

describe('DbModule', () => {
  it('registers requested repositories via forFeature', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DbModule.forFeature([VoteReadRepository, ProposalReadRepository])],
    }).compile();

    expect(moduleRef.get(VoteReadRepository)).toBeDefined();
    expect(moduleRef.get(ProposalReadRepository)).toBeDefined();
  });
});
