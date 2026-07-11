import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { AiTriggerScanner } from './ai-trigger-scanner';

const BATCH_CYCLE_MS = Number(process.env['AI_BATCH_CYCLE_MS'] ?? 4 * 60 * 60 * 1000); // 4h
const BATCH_LOOKBACK_MS = Number(process.env['AI_BATCH_LOOKBACK_MS'] ?? 8 * 60 * 60 * 1000); // 8h

/** Batch sweep / reconcile: re-scans a wider window every 4h. In M5-2 this maps to the Anthropic
 *  Batch-API submission window for batch-mode features; here it is the safety-net rescan. */
@Injectable()
export class AiBatchCycleService {
  private readonly logger = new Logger('AiBatchCycle');
  private inFlight = false;

  constructor(private readonly scanner: AiTriggerScanner) {}

  @Interval(BATCH_CYCLE_MS)
  async tick(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      await this.scanner.run(BATCH_LOOKBACK_MS);
    } catch (err) {
      this.logger.warn('ai_batch_cycle_failed', { error: String(err) });
    } finally {
      this.inFlight = false;
    }
  }
}
