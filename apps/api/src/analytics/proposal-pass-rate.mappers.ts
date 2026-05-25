import type { PassRateRow } from '@libs/db';
import type { PassRateRowDto } from './proposal-pass-rate.dto';
import { toIsoDate } from '../http/iso';

export function toPassRateRowDto(row: PassRateRow): PassRateRowDto {
  return {
    source_type: row.source_type,
    bucket: toIsoDate(row.bucket),
    passed: row.passed,
    failed: row.failed,
    pass_rate: row.pass_rate,
  };
}
