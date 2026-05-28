import type { AbiCacheTable, SelectorIndexTable } from './abi';
import type {
  ActorAddressRedirectTable,
  ActorAddressSourceTable,
  ActorAddressTable,
} from './actor-address';
import type { AdminAuditTable, ApiKeyTable, UsersTable } from './auth';
import type {
  ActorTable,
  DaoSourceTable,
  DaoTable,
  ProposalActionTable,
  ProposalChoiceTable,
  ProposalTable,
  SourceTypeTable,
} from './domain';
import type {
  ArchiveEventTable,
  IngestionDlqResolvedTable,
  IngestionDlqTable,
  ReconciliationWatermarkTable,
} from './ingestion';
import type { VotingPowerSnapshotRunTable } from './vote';

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
  NewReconciliationWatermark,
  ReconciliationWatermark,
  ReconciliationWatermarkTable,
} from './ingestion';
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
  VotingPowerSnapshotRun,
  VotingPowerSnapshotRunStatus,
  VotingPowerSnapshotRunTable,
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
  reconciliation_watermark: ReconciliationWatermarkTable;
  abi_cache: AbiCacheTable;
  selector_index: SelectorIndexTable;
  voting_power_snapshot_run: VotingPowerSnapshotRunTable;
  actor_address: ActorAddressTable;
  actor_address_redirect: ActorAddressRedirectTable;
  actor_address_source: ActorAddressSourceTable;
}
