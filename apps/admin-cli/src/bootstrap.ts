import {
  AdminAuditRepository,
  ApiKeyRepository,
  ArchiveDerivationRepository,
  DaoAdminRepository,
  DaoReadRepository,
  DaoSourceRepository,
  DlqRepository,
  ReorgEventRepository,
  ProposalReadRepository,
  SystemStatusRepository,
  UserRepository,
  pgDb,
} from '@libs/db';

export interface AdminCliContainer {
  daoSourceRepository: DaoSourceRepository;
  daoReadRepository: DaoReadRepository;
  daoAdminRepository: DaoAdminRepository;
  proposalReadRepository: ProposalReadRepository;
  userRepository: UserRepository;
  reorgEventRepository: ReorgEventRepository;
  apiKeyRepository: ApiKeyRepository;
  dlqRepository: DlqRepository;
  adminAuditRepository: AdminAuditRepository;
  archiveDerivationRepository: ArchiveDerivationRepository;
  systemStatusRepository: SystemStatusRepository;
}

export function buildContainer(): AdminCliContainer {
  return {
    daoSourceRepository: new DaoSourceRepository(pgDb),
    daoReadRepository: new DaoReadRepository(pgDb),
    daoAdminRepository: new DaoAdminRepository(pgDb),
    proposalReadRepository: new ProposalReadRepository(pgDb),
    userRepository: new UserRepository(pgDb),
    reorgEventRepository: new ReorgEventRepository(pgDb),
    apiKeyRepository: new ApiKeyRepository(pgDb),
    dlqRepository: new DlqRepository(pgDb),
    adminAuditRepository: new AdminAuditRepository(pgDb),
    archiveDerivationRepository: new ArchiveDerivationRepository(pgDb),
    systemStatusRepository: new SystemStatusRepository(pgDb),
  };
}
