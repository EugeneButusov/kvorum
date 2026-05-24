import type { AbiCacheTable, SelectorIndexTable } from './abi';
import type {
  ActorAddressRedirectTable,
  ActorAddressSourceTable,
  ActorAddressTable,
} from './actor-address';
import type { AdminAuditTable, ApiKeyTable, UsersTable } from './auth';
import type { DelegationTable } from './delegation';
import type {
  ActorTable,
  DaoSourceTable,
  DaoTable,
  ProposalActionTable,
  ProposalChoiceTable,
  ProposalTable,
  SourceTypeTable,
} from './domain';
import type { ArchiveEventTable, IngestionDlqResolvedTable, IngestionDlqTable } from './ingestion';
import type {
  VoteChoiceTable,
  VoteTable,
  VotingPowerSnapshotRunTable,
  VotingPowerSnapshotTable,
} from './vote';

export type { AdminAuditTable, ApiKeyTable, UsersTable } from './auth';
export type {
  AdminAudit,
  ApiKey,
  ApiKeyTier,
  AuditOutcome,
  ExecutorKind,
  NewAdminAudit,
  NewApiKey,
  NewUser,
  User,
  UserRole,
  UserUpdate,
} from './auth';

export type {
  Actor,
  ActorTable,
  ActorUpdate,
  Dao,
  DaoSource,
  DaoSourceTable,
  DaoSourceUpdate,
  DaoTable,
  DaoUpdate,
  DecodeStatus,
  NewActor,
  NewDao,
  NewDaoSource,
  NewProposal,
  NewProposalAction,
  NewProposalChoice,
  Proposal,
  ProposalAction,
  ProposalActionTable,
  ProposalChoice,
  ProposalChoiceTable,
  ProposalState,
  ProposalTable,
  ProposalUpdate,
  SourceType,
  SourceTypeTable,
} from './domain';

export type {
  AbiCache,
  AbiCacheTable,
  NewAbiCache,
  NewSelectorIndex,
  SelectorIndex,
  SelectorIndexTable,
} from './abi';
export type {
  ArchiveEvent,
  ArchiveEventTable,
  ArchiveEventUpdate,
  DlqResolutionKind,
  IngestionDlq,
  IngestionDlqResolved,
  IngestionDlqResolvedTable,
  IngestionDlqTable,
  NewArchiveEvent,
  NewIngestionDlq,
  NewIngestionDlqResolved,
} from './ingestion';
export type { Delegation, DelegationEventType, DelegationTable, NewDelegation } from './delegation';
export type {
  ActorAddress,
  ActorAddressRedirect,
  ActorAddressRedirectTable,
  ActorAddressRedirectUpdate,
  ActorAddressSource,
  ActorAddressSourceTable,
  ActorAddressTable,
  ActorAddressUpdate,
  NewActorAddress,
  NewActorAddressRedirect,
  NewActorAddressSource,
} from './actor-address';
export type {
  NewVote,
  NewVoteChoice,
  NewVotingPowerSnapshot,
  Vote,
  VoteChoice,
  VoteChoiceTable,
  VoteTable,
  VoteUpdate,
  VotingPowerSnapshot,
  VotingPowerSnapshotRun,
  VotingPowerSnapshotRunStatus,
  VotingPowerSnapshotRunTable,
  VotingPowerSnapshotTable,
  NewVotingPowerSnapshotRun,
} from './vote';

export interface PgDatabase {
  users: UsersTable;
  api_key: ApiKeyTable;
  admin_audit: AdminAuditTable;
  source_type: SourceTypeTable;
  dao: DaoTable;
  dao_source: DaoSourceTable;
  actor: ActorTable;
  proposal: ProposalTable;
  proposal_action: ProposalActionTable;
  proposal_choice: ProposalChoiceTable;
  archive_event: ArchiveEventTable;
  ingestion_dlq: IngestionDlqTable;
  ingestion_dlq_resolved: IngestionDlqResolvedTable;
  abi_cache: AbiCacheTable;
  selector_index: SelectorIndexTable;
  vote: VoteTable;
  vote_choice: VoteChoiceTable;
  voting_power_snapshot: VotingPowerSnapshotTable;
  voting_power_snapshot_run: VotingPowerSnapshotRunTable;
  delegation: DelegationTable;
  actor_address: ActorAddressTable;
  actor_address_redirect: ActorAddressRedirectTable;
  actor_address_source: ActorAddressSourceTable;
}
