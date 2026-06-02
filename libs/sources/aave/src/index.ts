export type {
  AavePayloadStatus,
  AaveProposalMetadata,
  AaveProposalMetadataTable,
  AaveProposalMetadataUpdate,
  AaveProposalPayload,
  AaveProposalPayloadTable,
  AaveProposalPayloadUpdate,
  NewAaveProposalMetadata,
  NewAaveProposalPayload,
} from './persistence/schema';

export * from './governance-v3';
export { DecodeError } from './shared';
export type {
  ArchiveWriteContext,
  ArchiveWriteOutcome,
  DecodeErrorReason,
  IngesterListenerOptions,
} from './shared';
