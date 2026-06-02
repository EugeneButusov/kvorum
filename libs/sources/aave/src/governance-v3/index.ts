export {
  AAVE_GOVERNANCE_V3_INTERFACE,
  AAVE_GOVERNANCE_V3_TOPICS,
  interfaceForAaveGovernanceV3,
} from './abi/events';
export type { AaveGovernanceV3EventType } from './abi/events';
export { decodeAaveGovernanceV3Log } from './abi/decoder';
export type {
  AaveGovernanceV3Event,
  PayloadSentPayload,
  ProposalCanceledPayload,
  ProposalCreatedPayload,
  ProposalExecutedPayload,
  ProposalFailedPayload,
  ProposalQueuedPayload,
  VotingActivatedPayload,
} from './domain/types';
