import type { ParticipationRow } from '@libs/db';
import type { ParticipationRowDto } from './participation.dto';
import { toIsoDate } from '../http/iso';

export function toParticipationRowDto(row: ParticipationRow): ParticipationRowDto {
  return {
    source_type: row.source_type,
    bucket: toIsoDate(row.bucket),
    participation_rate: row.participation_rate,
    proposal_count: row.proposal_count,
    proposals_with_data: row.proposals_with_data,
  };
}
