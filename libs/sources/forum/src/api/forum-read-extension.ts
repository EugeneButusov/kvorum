import type { Kysely } from 'kysely';
import type { PgDatabase } from '@libs/db';
import type {
  ChoiceBounds,
  CuratedDaoSourceConfig,
  DelegationModel,
  ForumLinkView,
  ProposalExtension,
  SourceReadExtension,
} from '@libs/domain';
import { asSourceConfigObject } from '@libs/domain';
import { ForumLinkReadRepository } from './forum-link-read-repository';

// Read surface for the `discourse_forum` source. Forum threads are not proposals/votes and carry no
// delegation. Two live methods: curateSourceConfig shapes the off-chain host/categories binding for
// GET /daos/{slug}/sources, and getForumLinks surfaces a proposal's linked threads (cross-source —
// fanned out over all extensions, so it runs for proposals of every source, not just forum's own).
export function makeForumReadExtension(db: Kysely<PgDatabase>): SourceReadExtension {
  const linkRepo = new ForumLinkReadRepository(db);
  return {
    sourceTypes: ['discourse_forum'],
    choiceBounds(_sourceType: string): ChoiceBounds {
      return { min: 0, max: 0 };
    },
    delegationModel(_sourceType: string): DelegationModel {
      return 'relationship-only';
    },
    getProposalExtension(
      _proposalId: string,
      _sourceType: string,
    ): Promise<ProposalExtension | null> {
      return Promise.resolve(null);
    },
    getForumLinks(proposalId: string): Promise<readonly ForumLinkView[]> {
      return linkRepo.getLinksForProposal(proposalId);
    },
    curateSourceConfig(_sourceType: string, rawConfig: unknown): CuratedDaoSourceConfig {
      // Off-chain Discourse source: binds by `host` (+ optional `categories`).
      const cfg = asSourceConfigObject(rawConfig);
      const config: CuratedDaoSourceConfig = {};
      if (typeof cfg['host'] === 'string') config['forum_host'] = cfg['host'];
      if (Array.isArray(cfg['categories'])) {
        config['forum_categories'] = cfg['categories'].filter(
          (c): c is string => typeof c === 'string',
        );
      }
      return config;
    },
  };
}
