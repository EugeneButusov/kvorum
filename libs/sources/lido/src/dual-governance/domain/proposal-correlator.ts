import { createHash } from 'node:crypto';
import { keccak256, toUtf8Bytes } from 'ethers';
import type { NewProposal, ProposalActionInput, ProposalState } from '@libs/db';
import type { ExternalCall } from './types';
import type { DualGovernanceProposalStatus } from '../../persistence/schema';

/** A direct-submission proposal minus the refs the applier resolves (dao_id, proposer_actor_id). */
export type DirectProposalDraft = Omit<NewProposal, 'dao_id' | 'proposer_actor_id'>;

/**
 * Deterministic hash of a Timelock submission's inner calls — the heuristic-fallback correlation key
 * and the audit anchor (ADR-0074 §4). Order-sensitive (execution order is semantic); each call is
 * normalized (target lowercased, value decimal, payload lowercased) so archive-faithful primitives
 * hash identically across re-derivations.
 */
export function computeCallsHash(calls: readonly ExternalCall[]): string {
  const normalized = calls.map((call) => ({
    target: call.target.toLowerCase(),
    value: call.value,
    payload: call.payload.toLowerCase(),
  }));
  return keccak256(toUtf8Bytes(JSON.stringify(normalized)));
}

/**
 * Map a submission's inner calls to `proposal_action` inputs (one per call, in submission order). These
 * are the real on-chain operations — what the Aragon EVMScript decoder can't see (it only sees the
 * opaque `submitProposal` call). `function_signature` is left null; the calldata-decode worker fills
 * `decoded_function` post-hoc, mirroring the EVMScript leaf convention.
 */
export function callsToProposalActions(
  calls: readonly ExternalCall[],
  chainId: string,
): ProposalActionInput[] {
  return calls.map((call) => ({
    targetAddress: call.target.toLowerCase(),
    targetChainId: chainId,
    valueWei: call.value,
    functionSignature: null,
    calldata: call.payload,
  }));
}

/**
 * The unified `proposal.state` for a DG-routed proposal is `f(ledger status)` (ADR-0074 §4): the DG
 * timelock sub-lifecycle is authoritative post-enactment. Applied idempotently via
 * `ProposalRepository.setStateFromDerivation`.
 */
export function ledgerStatusToProposalState(status: DualGovernanceProposalStatus): ProposalState {
  switch (status) {
    case 'submitted':
    case 'scheduled':
      return 'queued';
    case 'executed':
      return 'executed';
    case 'cancelled':
      return 'canceled';
  }
}

/** Write side of the unified `proposal.state` (the relevant slice of `ProposalRepository`). */
export interface UnifiedProposalStateWriter {
  setStateFromDerivation(input: {
    proposalId: string;
    state: ProposalState;
    stateUpdatedAt: Date;
  }): Promise<void>;
}

/** The ledger fields the unified-state resolver reads (a structural subset of `DualGovernanceProposal`). */
export interface UnifiedProposalLedgerRow {
  status: DualGovernanceProposalStatus;
  submitted_at: Date;
  cancelled_at: Date | null;
}

/**
 * The unified `proposal.state` for a DG-routed proposal, with ADR-031 `vetoed` precedence over
 * `f(ledger status)`. A **non-executed** proposal whose pending window `[submitted_at, cancelled_at ??
 * open]` is covered by a DG rage-quit transition is `vetoed` — ADR-031 distinguishes a community veto
 * from a plain cancellation, so a bulk-cancel that lands inside a rage-quit window resolves to `vetoed`,
 * not `canceled`. An executed proposal is `executed` regardless (the veto did not stop it).
 *
 * Pure: the caller supplies the DAO's rage-quit transition timestamps (fetched once from the state
 * history via `DualGovernanceStateHistoryRepository.rageQuitTransitionsForDao`). Replay-safe +
 * order-independent — whichever deriver resolves last (the proposal-flow handlers / the rage-quit step)
 * computes the same value from the same authoritative inputs, which is what keeps the two derivers (both
 * write `proposal.state`) from fighting.
 */
export function resolveUnifiedProposalState(
  ledger: UnifiedProposalLedgerRow,
  rageQuitTransitionAts: readonly Date[],
): ProposalState {
  if (ledger.status !== 'executed') {
    const covered = rageQuitTransitionAts.some(
      (at) =>
        at >= ledger.submitted_at && (ledger.cancelled_at === null || at <= ledger.cancelled_at),
    );
    if (covered) return 'vetoed';
  }
  return ledgerStatusToProposalState(ledger.status);
}

/**
 * Resolve a DG-routed proposal's unified state from the pre-fetched rage-quit transitions and write it
 * via the guard-bypassing `setStateFromDerivation`. Shared by the proposal-flow handlers (every
 * proposal-flow event) and the rage-quit veto step so the ADR-031 precedence is computed in one place.
 */
export async function applyUnifiedProposalState(
  proposals: UnifiedProposalStateWriter,
  ledger: UnifiedProposalLedgerRow & { proposal_id: string },
  rageQuitTransitionAts: readonly Date[],
  stateUpdatedAt: Date,
): Promise<ProposalState> {
  const state = resolveUnifiedProposalState(ledger, rageQuitTransitionAts);
  await proposals.setStateFromDerivation({ proposalId: ledger.proposal_id, state, stateUpdatedAt });
  return state;
}

export interface DirectProposalInput {
  dgProposalId: string;
  metadata: string;
  submittedBlock: string;
  submittedAt: Date;
}

/**
 * Field map for a direct DG submission's own `proposal` row (origin='direct', source_type=
 * 'dual_governance'). No Aragon vote exists, so title/description come from the DG `ProposalSubmittedMeta`
 * metadata; there is no Aragon voting window (the "window" is veto-signalling, out of AB3 scope), so
 * `voting_*_at` are null. State is `f(ledger status)`; the applier fills dao_id + proposer_actor_id.
 */
export function buildDirectProposal(input: DirectProposalInput): DirectProposalDraft {
  const description = input.metadata;
  return {
    source_type: 'dual_governance',
    source_id: input.dgProposalId,
    title: extractDirectTitle(description, input.dgProposalId),
    description,
    description_hash: createHash('sha256').update(description).digest('hex'),
    binding: true,
    voting_starts_at: null,
    voting_ends_at: null,
    voting_starts_block: input.submittedBlock,
    voting_ends_block: null,
    state: 'queued',
    state_updated_at: input.submittedAt,
    updated_at: input.submittedAt,
  };
}

const MAX_TITLE_LENGTH = 200;

/** First non-empty (markdown-heading-stripped) line of the DG metadata, else a stable placeholder. */
function extractDirectTitle(metadata: string, dgProposalId: string): string {
  for (const rawLine of metadata.split('\n')) {
    const line = rawLine.replace(/^#+\s*/, '').trim();
    if (line.length > 0) {
      return line.length > MAX_TITLE_LENGTH ? line.slice(0, MAX_TITLE_LENGTH) : line;
    }
  }
  return `Dual Governance proposal #${dgProposalId}`;
}
