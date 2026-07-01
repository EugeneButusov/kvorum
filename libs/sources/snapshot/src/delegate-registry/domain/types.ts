export interface DelegateEventPayload {
  delegator: string;
  // Raw bytes32 space id; decoded to a space name (or global) by the deriver.
  id: string;
  delegate: string;
}

export type DelegateRegistryEvent =
  | { type: 'SetDelegate'; payload: DelegateEventPayload }
  | { type: 'ClearDelegate'; payload: DelegateEventPayload };
