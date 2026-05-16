import {
  ApiKeyRepository,
  DaoSourceRepository,
  DlqRepository,
  ReorgEventRepository,
  pgDb,
} from '@libs/db';

export interface AdminCliContainer {
  daoSourceRepository: DaoSourceRepository;
  reorgEventRepository: ReorgEventRepository;
  apiKeyRepository: ApiKeyRepository;
  dlqRepository: DlqRepository;
}

export function buildContainer(): AdminCliContainer {
  return {
    daoSourceRepository: new DaoSourceRepository(pgDb),
    reorgEventRepository: new ReorgEventRepository(pgDb),
    apiKeyRepository: new ApiKeyRepository(pgDb),
    dlqRepository: new DlqRepository(pgDb),
  };
}
