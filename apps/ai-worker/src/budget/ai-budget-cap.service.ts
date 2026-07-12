import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { AiCostLogRepository } from '@libs/ai';
import { readPositiveInt } from '@libs/utils';
import { AiBudgetState } from './ai-budget-state';
import type { FeatureBudget } from './ai-budget-state';
import { AI_FEATURES, readCap, startOfCurrentMonthUtc } from './budget-config';
import { aiMetrics } from '../metrics/ai-metrics';
import type { AiFeature } from '../queue/ai-queue-names';

const CAP_CHECK_MS = readPositiveInt('AI_BUDGET_CAP_MS', 5 * 60 * 1000); // 5 min
const WARN_THRESHOLD_PCT = 90;

/** Every 5 minutes: compute month-to-date spend per feature from ai_cost_log, update the in-memory
 *  AiBudgetState + gauges, and edge-log at 90%/100%. Monthly reset is emergent (spend is measured
 *  from start-of-current-month). Runs once on bootstrap so a restart doesn't fail-open for ~5 min. */
@Injectable()
export class AiBudgetCapService implements OnApplicationBootstrap {
  private readonly logger = new Logger('AiBudgetCap');
  private inFlight = false;

  constructor(
    private readonly costRepo: AiCostLogRepository,
    private readonly budgetState: AiBudgetState,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.tick();
  }

  @Interval(CAP_CHECK_MS)
  async tick(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      const since = startOfCurrentMonthUtc(new Date());
      for (const feature of AI_FEATURES) {
        const spendUsd = await this.costRepo.sumCostForFeatureSince(feature, since);
        const capUsd = readCap(feature);
        const utilizationPct = capUsd > 0 ? (spendUsd / capUsd) * 100 : 0;
        const disabled = spendUsd >= capUsd;
        const prev = this.budgetState.get(feature);
        const next: FeatureBudget = { spendUsd, capUsd, utilizationPct, disabled };
        this.budgetState.set(feature, next);

        aiMetrics.costUsd.record(spendUsd, { feature });
        aiMetrics.budgetUtilizationPercent.record(utilizationPct, { feature });
        aiMetrics.featureDisabled.record(disabled ? 1 : 0, { feature });

        this.logTransitions(feature, prev, next);
      }
    } catch (err) {
      this.logger.warn('ai_budget_cap_check_failed', { error: String(err) });
    } finally {
      this.inFlight = false;
    }
  }

  /** Edge-triggered logs: fire once on the transition into warn/disabled (and back), not every tick. */
  private logTransitions(
    feature: AiFeature,
    prev: FeatureBudget | undefined,
    next: FeatureBudget,
  ): void {
    const wasDisabled = prev?.disabled ?? false;
    const wasWarn = (prev?.utilizationPct ?? 0) >= WARN_THRESHOLD_PCT;

    if (next.disabled && !wasDisabled) {
      this.logger.warn('ai_budget_disabled', {
        feature,
        spendUsd: next.spendUsd,
        capUsd: next.capUsd,
      });
    } else if (!next.disabled && wasDisabled) {
      this.logger.log('ai_budget_reenabled', {
        feature,
        spendUsd: next.spendUsd,
        capUsd: next.capUsd,
      });
    } else if (next.utilizationPct >= WARN_THRESHOLD_PCT && !wasWarn && !next.disabled) {
      this.logger.warn('ai_budget_warning', {
        feature,
        utilizationPct: next.utilizationPct,
        capUsd: next.capUsd,
      });
    }
  }
}
