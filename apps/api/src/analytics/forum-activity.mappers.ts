import type { ForumActivityRow } from '@libs/db';
import type { ForumActivityRowDto } from './forum-activity.dto';
import { toIsoDate } from '../http/iso';

export function toForumActivityRowDto(row: ForumActivityRow): ForumActivityRowDto {
  return {
    bucket: toIsoDate(row.bucket),
    post_count: row.post_count,
  };
}
