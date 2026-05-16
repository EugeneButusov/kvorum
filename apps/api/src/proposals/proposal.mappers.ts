import type { ProposalAction, ProposalChoice } from '@libs/db';
import { ProposalActionDto, ProposalDetailDto, ProposalListItemDto } from './proposal.dto';

type ProposalListRow = {
  id: string;
  dao_slug: string;
  source_type: string;
  source_id: string;
  title: string | null;
  state: string;
  binding: boolean;
  voting_starts_at: Date | null;
  voting_ends_at: Date | null;
  voting_power_block: string;
  state_updated_at: Date;
  created_at: Date;
  proposer_address: string;
  proposer_display_name: string | null;
};

type ProposalDetailRow = ProposalListRow & { description: string };

export function isoSeconds(value: Date | null): string | null {
  if (value === null) return null;
  return `${value.toISOString().slice(0, 19)}Z`;
}

function proposalMeta(row: ProposalListRow) {
  const base = `/v1/daos/${row.dao_slug}/proposals/${row.source_type}/${row.source_id}`;
  return {
    confirmed: true,
    last_updated_at: isoSeconds(row.state_updated_at),
    links: {
      self: base,
      votes: `${base}/votes`,
    },
  };
}

export function toProposalActionDto(action: ProposalAction): ProposalActionDto {
  return Object.assign(new ProposalActionDto(), {
    action_index: action.action_index,
    target_address: action.target_address.toLowerCase(),
    target_chain_id: action.target_chain_id,
    value_wei: action.value_wei,
    function_signature: action.function_signature,
    calldata: action.calldata,
    decoded_function: action.decoded_function,
    decoded_arguments: action.decoded_arguments,
  });
}

export function toProposalDetailDto(
  row: ProposalDetailRow,
  actions: ProposalAction[],
  choices: ProposalChoice[],
): ProposalDetailDto {
  return Object.assign(new ProposalDetailDto(), {
    dao_slug: row.dao_slug,
    source_type: row.source_type,
    source_id: row.source_id,
    title: row.title,
    description: row.description,
    state: row.state,
    binding: row.binding,
    voting_starts_at: isoSeconds(row.voting_starts_at),
    voting_ends_at: isoSeconds(row.voting_ends_at),
    voting_power_block: row.voting_power_block,
    proposer: {
      address: row.proposer_address.toLowerCase(),
      display_name: row.proposer_display_name,
    },
    actions: actions.map(toProposalActionDto),
    choices: choices.map((choice) => ({
      choice_index: choice.choice_index,
      value: choice.value,
    })),
    _meta: proposalMeta(row),
  });
}

export function toProposalListItemDto(row: ProposalListRow): ProposalListItemDto {
  return Object.assign(new ProposalListItemDto(), {
    dao_slug: row.dao_slug,
    source_type: row.source_type,
    source_id: row.source_id,
    title: row.title,
    state: row.state,
    binding: row.binding,
    voting_starts_at: isoSeconds(row.voting_starts_at),
    voting_ends_at: isoSeconds(row.voting_ends_at),
    voting_power_block: row.voting_power_block,
    proposer: {
      address: row.proposer_address.toLowerCase(),
      display_name: row.proposer_display_name,
    },
    _meta: proposalMeta(row),
  });
}
