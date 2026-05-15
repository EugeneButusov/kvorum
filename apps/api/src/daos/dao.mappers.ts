import type { Dao, DaoSource } from '@libs/db';

type CuratedSourceConfig = {
  contract_address?: string;
  chain_id?: string;
};

type DaoSourceDto = {
  source_type: string;
  contract_address?: string;
  chain_id?: string;
};

export function curateSourceConfig(raw: unknown): CuratedSourceConfig {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }

  const cfg = raw as Record<string, unknown>;
  const contractAddress =
    typeof cfg['contract_address'] === 'string' ? cfg['contract_address'].toLowerCase() : undefined;

  const rawChainId = cfg['chain_id'];
  const chainId =
    typeof rawChainId === 'string'
      ? rawChainId
      : typeof rawChainId === 'number'
        ? String(rawChainId)
        : undefined;

  return {
    ...(contractAddress === undefined ? {} : { contract_address: contractAddress }),
    ...(chainId === undefined ? {} : { chain_id: chainId }),
  };
}

export function toDaoSourceDto(
  row: Pick<DaoSource, 'source_type' | 'source_config'>,
): DaoSourceDto {
  return {
    source_type: row.source_type,
    ...curateSourceConfig(row.source_config),
  };
}

export function isoSeconds(value: Date | null): string | null {
  if (value === null) {
    return null;
  }

  return `${value.toISOString().slice(0, 19)}Z`;
}

export function toDaoListItemDto(dao: Dao) {
  return {
    slug: dao.slug,
    name: dao.name,
    description: dao.description,
    website_url: dao.website_url,
    forum_url: dao.forum_url,
    primary_token_address: dao.primary_token_address.toLowerCase(),
    primary_chain_id: dao.primary_chain_id,
    _meta: {
      last_updated_at: isoSeconds(dao.updated_at),
      links: {
        self: `/v1/daos/${dao.slug}`,
      },
    },
  };
}

export function toDaoDetailDto(
  dao: Dao,
  sources: Array<Pick<DaoSource, 'source_type' | 'source_config'>>,
) {
  return {
    ...toDaoListItemDto(dao),
    sources: sources.map(toDaoSourceDto),
  };
}
