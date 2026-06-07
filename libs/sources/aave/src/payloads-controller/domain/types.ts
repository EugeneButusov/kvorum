export interface ExecutionActionPayload {
  target: string;
  withDelegateCall: boolean;
  accessLevel: number;
  value: string;
  signature: string;
  callData: string;
}

export interface PayloadCreatedPayload {
  payloadId: string;
  creator: string;
  maximumAccessLevelRequired: number;
  actions: ExecutionActionPayload[];
}

export interface PayloadLifecyclePayload {
  payloadId: string;
}

export type AavePayloadsControllerEvent =
  | { type: 'PayloadCreated'; payload: PayloadCreatedPayload }
  | { type: 'PayloadQueued'; payload: PayloadLifecyclePayload }
  | { type: 'PayloadExecuted'; payload: PayloadLifecyclePayload }
  | { type: 'PayloadCancelled'; payload: PayloadLifecyclePayload };
