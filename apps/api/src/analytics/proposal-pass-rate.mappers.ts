import type { PassRateRow } from './analytics-read-repository';
import type { PassRateRowDto } from './proposal-pass-rate.dto';

export function toPassRateRowDto(row: PassRateRow): PassRateRowDto {
  return {
    source_type: row.source_type,
    bucket: row.bucket.toISOString(),
    passed: row.passed,
    failed: row.failed,
    pass_rate: row.pass_rate,
  };
}
