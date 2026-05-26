import type { Generated, Insertable, Selectable } from 'kysely';

export type MirrorEtlRunStatus = 'in_progress' | 'completed' | 'failed';

export interface EtlWatermarkTable {
  name: string;
  watermark: Date;
  updated_at: Generated<Date>;
}

export type EtlWatermark = Selectable<EtlWatermarkTable>;
export type NewEtlWatermark = Insertable<EtlWatermarkTable>;

export interface MirrorEtlRunTable {
  job_name: string;
  watermark_from: Date;
  watermark_to: Date;
  status: MirrorEtlRunStatus;
  attempt_count: Generated<number>;
  rows_written: Generated<number>;
  exact_match: boolean | null;
  drift_ratio: number | null;
  last_error: string | null;
  started_at: Generated<Date>;
  completed_at: Date | null;
}

export type MirrorEtlRun = Selectable<MirrorEtlRunTable>;
export type NewMirrorEtlRun = Insertable<MirrorEtlRunTable>;
