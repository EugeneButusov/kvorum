import type { ProposalActionInput } from '@libs/db';
import type { ArchiveEventType } from '@libs/domain';
import type { PayloadCreatedPayload } from './types';

export interface PayloadStatusTransition {
  targetStatus: 'created' | 'queued' | 'executed' | 'cancelled';
  allowedFrom: readonly ('declared' | 'created' | 'queued')[];
}

export function statusTransitionFor(eventType: ArchiveEventType): PayloadStatusTransition {
  switch (eventType) {
    case 'PayloadCreated':
      return { targetStatus: 'created', allowedFrom: ['declared'] };
    case 'PayloadQueued':
      return { targetStatus: 'queued', allowedFrom: ['declared', 'created'] };
    case 'PayloadExecuted':
      return { targetStatus: 'executed', allowedFrom: ['declared', 'created', 'queued'] };
    case 'PayloadCancelled':
      return { targetStatus: 'cancelled', allowedFrom: ['declared', 'created', 'queued'] };
    default:
      throw new Error(`unsupported payload event type ${eventType}`);
  }
}

export function projectPayloadActions(
  payload: PayloadCreatedPayload,
  chainId: string,
): ProposalActionInput[] {
  return payload.actions.map((action) => ({
    targetAddress: action.target,
    targetChainId: chainId,
    valueWei: action.value,
    functionSignature: action.signature === '' ? null : action.signature,
    calldata: action.callData,
  }));
}
