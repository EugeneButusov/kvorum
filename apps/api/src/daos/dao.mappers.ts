import type { Dao, DaoSource } from '@libs/db';
import { curateSourceConfigFor, type SourceReadExtension } from '@libs/domain';
import { DaoDetailDto, DaoListItemDto, DaoSourceDto } from './dao.dto';
import { isoSeconds } from '../http/iso';

// Source-blind: `off_chain` and the config field set (contract/chain vs space vs host) are curated
// by each source's read extension via curateSourceConfigFor — apps/api holds no per-source knowledge.
export function toDaoSourceDto(
  row: Pick<DaoSource, 'source_type' | 'source_config'>,
  extensions: readonly SourceReadExtension[],
): DaoSourceDto {
  const { off_chain, config } = curateSourceConfigFor(
    extensions,
    row.source_type,
    row.source_config,
  );
  return Object.assign(new DaoSourceDto(), { source_type: row.source_type, off_chain, config });
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
  extensions: readonly SourceReadExtension[],
): DaoDetailDto {
  return Object.assign(new DaoDetailDto(), {
    ...toDaoListItemDto(dao),
    sources: sources.map((s) => toDaoSourceDto(s, extensions)),
  });
}
