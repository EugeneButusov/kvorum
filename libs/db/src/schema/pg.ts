import type { AbiCacheTable, SelectorIndexTable } from './abi';
import type {
  ActorAddressRedirectTable,
  ActorAddressSourceTable,
  ActorAddressTable,
} from './actor-address';
import type { AiOutputTable, AiCostLogTable, AiDlqTable } from './ai';
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
  OffChainCursorTable,
} from './ingestion';
import type { SeenLogTable } from './seen-log';
export type { SeenLog, SeenLogTable, NewSeenLog } from './seen-log';

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
  AiOutput,
  AiOutputTable,
  NewAiOutput,
  AiCostLog,
  AiCostLogTable,
  NewAiCostLog,
  AiDlq,
  AiDlqTable,
  NewAiDlq,
} from './ai';
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
  OffChainCursor,
  OffChainCursorTable,
  NewOffChainCursor,
  OffChainCursorUpdate,
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
  off_chain_cursor: OffChainCursorTable;
  abi_cache: AbiCacheTable;
  selector_index: SelectorIndexTable;
  actor_address: ActorAddressTable;
  actor_address_redirect: ActorAddressRedirectTable;
  actor_address_source: ActorAddressSourceTable;
  seen_log: SeenLogTable;
  ai_output: AiOutputTable;
  ai_cost_log: AiCostLogTable;
  ai_dlq: AiDlqTable;
}
