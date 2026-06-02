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
export { DecodeError } from '@sources/core';
export type {
  ArchiveWriteContext,
  ArchiveWriteOutcome,
  DecodeErrorReason,
  IngesterListenerOptions,
} from '@sources/core';
