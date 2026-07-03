import type {
  ChoiceBounds,
  CuratedDaoSourceConfig,
  DelegationModel,
  ProposalExtension,
  SourceReadExtension,
} from '@libs/domain';

// Minimal read surface for the `discourse_forum` source. Forum threads are not proposals/votes and
// carry no delegation — they surface on proposal detail via `proposal_forum_link` (the read-path
// work), not through a source proposal/vote extension. The one live method is curateSourceConfig,
// which shapes the off-chain host/categories binding for GET /daos/{slug}/sources.
export function makeForumReadExtension(): SourceReadExtension {
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
    curateSourceConfig(_sourceType: string, rawConfig: unknown): CuratedDaoSourceConfig {
      // Off-chain Discourse source: binds by `host` (+ optional `categories`).
      const cfg =
        rawConfig !== null && typeof rawConfig === 'object' && !Array.isArray(rawConfig)
          ? (rawConfig as Record<string, unknown>)
          : {};
      const forumHost = typeof cfg['host'] === 'string' ? cfg['host'] : undefined;
      const forumCategories = Array.isArray(cfg['categories'])
        ? cfg['categories'].filter((c): c is string => typeof c === 'string')
        : undefined;
      return {
        off_chain: true,
        ...(forumHost === undefined ? {} : { forum_host: forumHost }),
        ...(forumCategories === undefined ? {} : { forum_categories: forumCategories }),
      };
    },
  };
}
