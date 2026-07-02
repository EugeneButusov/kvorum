import type { Dao, DaoSource } from '@libs/db';
import { DaoDetailDto, DaoListItemDto, DaoSourceDto } from './dao.dto';
import { isoSeconds } from '../http/iso';

type CuratedSourceConfig = {
  contract_address?: string;
  chain_id?: string;
  space?: string;
  forum_host?: string;
  forum_categories?: string[];
};

// Off-chain sources bind by space/host in source_config (ADR-064 / ADR-0071) rather than a
// contract address; the API surfaces that so consumers can tell the four Lido tracks apart.
const OFF_CHAIN_SOURCE_TYPES = new Set(['snapshot', 'discourse_forum']);

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

  // Snapshot binds by `space`; Discourse forum by `host` (+ optional `categories`).
  const space = typeof cfg['space'] === 'string' ? cfg['space'] : undefined;
  const forumHost = typeof cfg['host'] === 'string' ? cfg['host'] : undefined;
  const forumCategories = Array.isArray(cfg['categories'])
    ? cfg['categories'].filter((c): c is string => typeof c === 'string')
    : undefined;

  return {
    ...(contractAddress === undefined ? {} : { contract_address: contractAddress }),
    ...(chainId === undefined ? {} : { chain_id: chainId }),
    ...(space === undefined ? {} : { space }),
    ...(forumHost === undefined ? {} : { forum_host: forumHost }),
    ...(forumCategories === undefined ? {} : { forum_categories: forumCategories }),
  };
}

export function toDaoSourceDto(
  row: Pick<DaoSource, 'source_type' | 'source_config'>,
): DaoSourceDto {
  return Object.assign(new DaoSourceDto(), {
    source_type: row.source_type,
    off_chain: OFF_CHAIN_SOURCE_TYPES.has(row.source_type),
    ...curateSourceConfig(row.source_config),
  });
}

export function toDaoListItemDto(dao: Dao): DaoListItemDto {
  return Object.assign(new DaoListItemDto(), {
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
  });
}

export function toDaoDetailDto(
  dao: Dao,
  sources: Array<Pick<DaoSource, 'source_type' | 'source_config'>>,
): DaoDetailDto {
  return Object.assign(new DaoDetailDto(), {
    ...toDaoListItemDto(dao),
    sources: sources.map(toDaoSourceDto),
  });
}
