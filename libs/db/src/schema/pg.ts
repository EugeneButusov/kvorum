import type { AdminAuditTable, ApiKeyTable, UsersTable } from './auth';
import type {
  ActorTable,
  DaoSourceTable,
  DaoTable,
  ProposalActionTable,
  ProposalChoiceTable,
  ProposalTable,
  ReorgEventTable,
  SourceTypeTable,
} from './domain';
import type {
  AbiCacheTable,
  ArchiveConfirmationTable,
  IngestionDlqResolvedTable,
  IngestionDlqTable,
  SelectorIndexTable,
} from './ingestion';

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
  NewActor,
  NewDao,
  NewDaoSource,
  NewProposal,
  NewProposalAction,
  NewProposalChoice,
  NewReorgEvent,
  Proposal,
  ProposalAction,
  ProposalActionTable,
  ProposalChoice,
  ProposalChoiceTable,
  ProposalState,
  ProposalTable,
  ProposalUpdate,
  ReorgEvent,
  ReorgEventTable,
  SourceType,
  SourceTypeTable,
} from './domain';

export type {
  AbiCache,
  AbiCacheTable,
  ArchiveConfirmation,
  ArchiveConfirmationTable,
  ArchiveConfirmationUpdate,
  ConfirmationStatus,
  DlqResolutionKind,
  IngestionDlq,
  IngestionDlqResolved,
  IngestionDlqResolvedTable,
  IngestionDlqTable,
  NewAbiCache,
  NewArchiveConfirmation,
  NewIngestionDlq,
  NewIngestionDlqResolved,
  NewSelectorIndex,
  SelectorIndex,
  SelectorIndexTable,
} from './ingestion';

export interface PgDatabase {
  // auth / admin
  users: UsersTable;
  api_key: ApiKeyTable;
  admin_audit: AdminAuditTable;
  // reference tables
  source_type: SourceTypeTable;
  // core domain
  dao: DaoTable;
  dao_source: DaoSourceTable;
  actor: ActorTable;
  proposal: ProposalTable;
  proposal_action: ProposalActionTable;
  proposal_choice: ProposalChoiceTable;
  reorg_event: ReorgEventTable;
  // ingestion
  archive_confirmation: ArchiveConfirmationTable;
  ingestion_dlq: IngestionDlqTable;
  ingestion_dlq_resolved: IngestionDlqResolvedTable;
  abi_cache: AbiCacheTable;
  selector_index: SelectorIndexTable;
}
