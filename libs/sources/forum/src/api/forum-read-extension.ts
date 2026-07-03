import type {
  ChoiceBounds,
  CuratedDaoSourceConfig,
  DelegationModel,
  ProposalExtension,
  SourceReadExtension,
} from '@libs/domain';
import { asSourceConfigObject } from '@libs/domain';

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
      const cfg = asSourceConfigObject(rawConfig);
      const config: Record<string, string | string[]> = {};
      if (typeof cfg['host'] === 'string') config['forum_host'] = cfg['host'];
      if (Array.isArray(cfg['categories'])) {
        config['forum_categories'] = cfg['categories'].filter(
          (c): c is string => typeof c === 'string',
        );
      }
      return { off_chain: true, config };
    },
  };
}
