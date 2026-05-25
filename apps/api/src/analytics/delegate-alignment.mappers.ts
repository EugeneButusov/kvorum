import type { DelegateAlignmentRow } from '@libs/db';
import type { DelegateAlignmentPeerDto } from './delegate-alignment.dto';

export function toDelegateAlignmentPeerDto(
  row: DelegateAlignmentRow,
  actor: { primary_address: string; display_name: string | null } | undefined,
): DelegateAlignmentPeerDto {
  return {
    actor_id: row.peer_actor_id,
    address: actor?.primary_address ?? '',
    display_name: actor?.display_name ?? null,
    vote_count: row.vote_count,
    shared_proposals: row.shared_proposals,
    alignment_score: row.shared_proposals === 0 ? 0 : row.matched_choices / row.shared_proposals,
  };
}
