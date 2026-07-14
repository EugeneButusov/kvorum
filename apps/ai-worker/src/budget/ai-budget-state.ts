import { Injectable } from '@nestjs/common';
import type { AiFeature } from '../queue/ai-queue-names';

export interface FeatureBudget {
  spendUsd: number;
  capUsd: number;
  utilizationPct: number;
  disabled: boolean;
}

/** In-memory per-feature budget status, written by AiBudgetCapService (the 5-min cron) and read by
 *  the enqueue (AiTriggerScanner) and worker (AiJobConsumer) paths. All in one process, so coherent.
 *  Fail-open: a feature with no computed budget yet is treated as enabled (the bootstrap cron tick
 *  closes this window at startup). */
@Injectable()
export class AiBudgetState {
  private readonly byFeature = new Map<AiFeature, FeatureBudget>();

  set(feature: AiFeature, budget: FeatureBudget): void {
    this.byFeature.set(feature, budget);
  }

  get(feature: AiFeature): FeatureBudget | undefined {
    return this.byFeature.get(feature);
  }

  isDisabled(feature: AiFeature): boolean {
    return this.byFeature.get(feature)?.disabled ?? false;
  }

  snapshot(): ReadonlyMap<AiFeature, FeatureBudget> {
    return new Map(this.byFeature);
  }
}
