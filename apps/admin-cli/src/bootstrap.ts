import {
  ApiKeyRepository,
  DaoSourceRepository,
  DlqRepository,
  ReorgEventRepository,
  pgDb,
  SystemStatusRepository,
} from '@libs/db';

export interface AdminCliContainer {
  daoSourceRepository: DaoSourceRepository;
  reorgEventRepository: ReorgEventRepository;
  apiKeyRepository: ApiKeyRepository;
  dlqRepository: DlqRepository;
  systemStatusRepository: SystemStatusRepository;
}

export function buildContainer(): AdminCliContainer {
  return {
    daoSourceRepository: new DaoSourceRepository(pgDb),
    reorgEventRepository: new ReorgEventRepository(pgDb),
    apiKeyRepository: new ApiKeyRepository(pgDb),
    dlqRepository: new DlqRepository(pgDb),
    systemStatusRepository: new SystemStatusRepository(pgDb),
  };
}
