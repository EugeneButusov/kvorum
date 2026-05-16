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
  chDb,
  pgDb,
} from '@libs/db';
import { CompoundArchivePayloadRepository } from '@sources/compound/governor/data-access';

export interface AdminCliContainer {
  daoSourceRepository: DaoSourceRepository;
  daoReadRepository: DaoReadRepository;
  daoAdminRepository: DaoAdminRepository;
  proposalReadRepository: ProposalReadRepository;
  userRepository: UserRepository;
  compoundArchivePayloadRepository: CompoundArchivePayloadRepository;
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
    compoundArchivePayloadRepository: new CompoundArchivePayloadRepository(chDb),
    reorgEventRepository: new ReorgEventRepository(pgDb),
    apiKeyRepository: new ApiKeyRepository(pgDb),
    dlqRepository: new DlqRepository(pgDb),
    adminAuditRepository: new AdminAuditRepository(pgDb),
    archiveDerivationRepository: new ArchiveDerivationRepository(pgDb),
    systemStatusRepository: new SystemStatusRepository(pgDb),
  };
}
