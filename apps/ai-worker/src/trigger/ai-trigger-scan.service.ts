import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { AiTriggerScanner } from './ai-trigger-scanner';
import { readPositiveInt } from '../app/env-helpers';

// @Interval args are evaluated at module load; env is set at process start (indexer does the same).
const SCAN_MS = readPositiveInt('AI_TRIGGER_SCAN_MS', 60_000);
const LOOKBACK_MS = readPositiveInt('AI_TRIGGER_LOOKBACK_MS', 600_000); // 10 min

/** Low-latency trigger path: scans recent proposal transitions every AI_TRIGGER_SCAN_MS. */
@Injectable()
export class AiTriggerScanService {
  private readonly logger = new Logger('AiTriggerScan');
  private inFlight = false;

  constructor(private readonly scanner: AiTriggerScanner) {}

  @Interval(SCAN_MS)
  async tick(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      await this.scanner.run(LOOKBACK_MS);
    } catch (err) {
      this.logger.warn('ai_trigger_scan_failed', { error: String(err) });
    } finally {
      this.inFlight = false;
    }
  }
}
