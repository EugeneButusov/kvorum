import type { AiOutput, ProposalSummary } from '@libs/ai';
import type { ProposalAction, ProposalChoice } from '@libs/db';
import type {
  OffchainDiscussionLinkView,
  ProposalExtension,
  ProposalPayloadView,
} from '@libs/domain';
import {
  OffchainDiscussionLinkDto,
  ProposalPayloadDto,
  ProposalPayloadGroupDto,
  ProposalVotingDto,
} from '@nest/sources';
import {
  ProposalActionDto,
  ProposalAiSummaryDto,
  ProposalAiSummaryMetaDto,
  ProposalDetailDto,
  ProposalListItemDto,
  type ProposalTallySummaryDto,
} from './proposal.dto';
import { isoSeconds } from '../http/iso';

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
  state_updated_at: Date;
  created_at: Date;
  proposer_address: string;
  proposer_display_name: string | null;
};

type ProposalDetailRow = ProposalListRow & { description: string };

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

/** Map a stored `ai_output` row into the API's `ai_summary` block: the ProposalSummary payload plus
 *  a provenance `_meta` (SPEC §5.4). */
export function toAiSummaryDto(output: AiOutput): ProposalAiSummaryDto {
  return Object.assign(new ProposalAiSummaryDto(), output.output as ProposalSummary, {
    _meta: Object.assign(new ProposalAiSummaryMetaDto(), {
      ai_generated: true,
      model: output.model,
      prompt_version: output.prompt_version,
      input_hash: output.input_hash,
      generated_at: isoSeconds(output.generated_at),
    }),
  });
}

export function toProposalDetailDto(
  row: ProposalDetailRow,
  actions: ProposalAction[],
  choices: ProposalChoice[],
  originChainId: string,
  extension: ProposalExtension | null,
  offchainDiscussionLinks: readonly OffchainDiscussionLinkView[],
  aiSummary: AiOutput | null,
): ProposalDetailDto {
  const dto = Object.assign(new ProposalDetailDto(), {
    dao_slug: row.dao_slug,
    source_type: row.source_type,
    source_id: row.source_id,
    title: row.title,
    description: row.description,
    state: row.state,
    binding: row.binding,
    voting_starts_at: isoSeconds(row.voting_starts_at),
    voting_ends_at: isoSeconds(row.voting_ends_at),
    proposer: {
      address: row.proposer_address.toLowerCase(),
      display_name: row.proposer_display_name,
    },
    actions: actions.map(toProposalActionDto),
    choices: choices.map((choice) => ({
      choice_index: choice.choice_index,
      value: choice.value,
    })),
    origin_chain_id: originChainId,
    metadata: extension?.metadata ?? null,
    offchain_discussion_links: offchainDiscussionLinks.map((link) =>
      Object.assign(new OffchainDiscussionLinkDto(), {
        platform: link.platform,
        host: link.host,
        url: link.url,
        title: link.title,
        confidence: link.confidence,
        last_activity_at: link.last_activity_at,
      }),
    ),
    ai_summary: aiSummary === null ? null : toAiSummaryDto(aiSummary),
    _meta: proposalMeta(row),
  });

  if (extension !== null) {
    dto.voting =
      extension.voting === null ? null : Object.assign(new ProposalVotingDto(), extension.voting);
    dto.payloads = groupPayloads(extension.payloads);
  }

  return dto;
}

function groupPayloads(payloads: readonly ProposalPayloadView[]): ProposalPayloadGroupDto[] {
  const groups = new Map<string, ProposalPayloadGroupDto>();
  for (const p of payloads) {
    let group = groups.get(p.target_chain_id);
    if (group === undefined) {
      group = Object.assign(new ProposalPayloadGroupDto(), {
        target_chain_id: p.target_chain_id,
        payloads: [],
      });
      groups.set(p.target_chain_id, group);
    }
    group.payloads.push(
      Object.assign(new ProposalPayloadDto(), {
        payload_index: p.payload_index,
        payload_id: p.payload_id,
        payloads_controller_address: p.payloads_controller_address,
        status: p.status,
        executed_at_destination: p.executed_at_destination,
        unindexed_target_chain: p.unindexed_target_chain,
      }),
    );
  }
  return Array.from(groups.values());
}

export function toProposalListItemDto(
  row: ProposalListRow,
  tally: ProposalTallySummaryDto | null = null,
): ProposalListItemDto {
  return Object.assign(new ProposalListItemDto(), {
    dao_slug: row.dao_slug,
    source_type: row.source_type,
    source_id: row.source_id,
    title: row.title,
    state: row.state,
    binding: row.binding,
    voting_starts_at: isoSeconds(row.voting_starts_at),
    voting_ends_at: isoSeconds(row.voting_ends_at),
    proposer: {
      address: row.proposer_address.toLowerCase(),
      display_name: row.proposer_display_name,
    },
    tally,
    _meta: proposalMeta(row),
  });
}
