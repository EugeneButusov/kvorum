import type { IngestionDlq } from '@libs/db';
import { MirrorEtlCliRunner, type MirrorEtlJobName } from '../mirror-etl-runner.js';
import type { DlqRetryAdapter, RetryOutcome } from './dlq-retry-adapter.js';

function jobNameFromPayload(payload: unknown): MirrorEtlJobName {
  if (payload == null || typeof payload !== 'object') {
    throw new Error('mirror_etl_run DLQ payload is not an object');
  }

  const rec = payload as Record<string, unknown>;
  const jobName = rec['job_name'];
  if (jobName !== 'vote_events_etl' && jobName !== 'delegation_flow_etl') {
    throw new Error('mirror_etl_run DLQ payload is missing valid job_name');
  }

  return jobName;
}

export class MirrorEtlRunAdapter implements DlqRetryAdapter {
  readonly stage = 'mirror_etl_run';
  private readonly runner = new MirrorEtlCliRunner();

  async retry(dlqEntry: IngestionDlq): Promise<RetryOutcome> {
    const jobName = jobNameFromPayload(dlqEntry.payload);
    const outcome = await this.runner.runJob(jobName);
    if (outcome.outcome !== 'completed') {
      throw new Error(`mirror-etl retry failed with outcome=${outcome.outcome}`);
    }

    return {
      status: 'resolved',
      reason: `mirror-etl retry completed for ${jobName}`,
    };
  }
}
