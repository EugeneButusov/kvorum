import type { IngestionDlq } from '@libs/db';

export interface RetryOutcome {
  status: 'resolved';
  reason: string;
}

export interface DlqRetryAdapter {
  readonly stage: string;
  retry(row: IngestionDlq): Promise<RetryOutcome>;
}
