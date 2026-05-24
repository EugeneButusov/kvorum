import {
  AdminAuditRepository,
  ApiKeyRepository,
  ArchiveDerivationAdminRepository,
  DaoAdminRepository,
  DaoReadRepository,
  DaoSourceRepository,
  DlqRepository,
  ProposalReadRepository,
  SystemStatusRepository,
  UserRepository,
  chDb,
  pgDb,
} from '@libs/db';
import { GovernorArchivePayloadRepository } from '@sources/compound/governor/data-access';

export interface AdminCliContainer {
  daoSourceRepository: DaoSourceRepository;
  daoReadRepository: DaoReadRepository;
  daoAdminRepository: DaoAdminRepository;
  proposalReadRepository: ProposalReadRepository;
  userRepository: UserRepository;
  compoundGovernorArchivePayloadRepository: GovernorArchivePayloadRepository;
  apiKeyRepository: ApiKeyRepository;
  dlqRepository: DlqRepository;
  adminAuditRepository: AdminAuditRepository;
  archiveDerivationRepository: ArchiveDerivationAdminRepository;
  systemStatusRepository: SystemStatusRepository;
}

export function buildContainer(): AdminCliContainer {
  return {
    daoSourceRepository: new DaoSourceRepository(pgDb),
    daoReadRepository: new DaoReadRepository(pgDb),
    daoAdminRepository: new DaoAdminRepository(pgDb),
    proposalReadRepository: new ProposalReadRepository(pgDb),
    userRepository: new UserRepository(pgDb),
    compoundGovernorArchivePayloadRepository: new GovernorArchivePayloadRepository(chDb),
    apiKeyRepository: new ApiKeyRepository(pgDb),
    dlqRepository: new DlqRepository(pgDb),
    adminAuditRepository: new AdminAuditRepository(pgDb),
    archiveDerivationRepository: new ArchiveDerivationAdminRepository(pgDb),
    systemStatusRepository: new SystemStatusRepository(pgDb),
  };
}
