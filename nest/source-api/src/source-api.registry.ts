import { Inject, Injectable } from '@nestjs/common';
import type { ChoiceBounds, ProposalExtension, SourceApiContribution } from '@libs/domain';

export const SOURCE_API_CONTRIBUTIONS = 'SOURCE_API_CONTRIBUTIONS';

@Injectable()
export class SourceApiRegistry {
  private readonly choiceBoundsCache = new Map<string, ChoiceBounds>();
  private readonly bySourceType = new Map<string, SourceApiContribution>();

  constructor(@Inject(SOURCE_API_CONTRIBUTIONS) contributions: SourceApiContribution[]) {
    for (const contribution of contributions) {
      for (const sourceType of contribution.sourceTypes) {
        this.bySourceType.set(sourceType, contribution);
        this.choiceBoundsCache.set(sourceType, contribution.choiceBounds(sourceType));
      }
    }
  }

  // Returns a wide default {min:0,max:2} for unknown source types — never 500s.
  choiceBounds(sourceType: string): ChoiceBounds {
    return this.choiceBoundsCache.get(sourceType) ?? { min: 0, max: 2 };
  }

  getProposalExtension(proposalId: string, sourceType: string): Promise<ProposalExtension | null> {
    const contribution = this.bySourceType.get(sourceType);
    if (contribution === undefined) return Promise.resolve(null);
    return contribution.getProposalExtension(proposalId, sourceType);
  }
}
