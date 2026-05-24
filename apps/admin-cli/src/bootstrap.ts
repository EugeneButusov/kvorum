import {
  AdminAuditRepository,
  ApiKeyRepository,
  ArchiveDerivationAdminRepository,
  ActorMergeRepository,
  ActorRepository,
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
  actorRepository: ActorRepository;
  actorMergeRepository: ActorMergeRepository;
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
    actorRepository: new ActorRepository(pgDb),
    actorMergeRepository: new ActorMergeRepository(pgDb),
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
