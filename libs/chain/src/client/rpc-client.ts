import type { ProviderState } from './provider-state.js';

export interface RpcSendOptions {
  deadlineMs?: number;
}

export interface RpcClientHealth {
  chainId: string;
  providers: Array<
    Readonly<ProviderState> & {
      circuitState: 'closed' | 'open' | 'half-open';
    }
  >;
}

export interface RpcClient {
  send<T = unknown>(method: string, params: unknown[], opts?: RpcSendOptions): Promise<T>;
  getHealth(): RpcClientHealth;
  start(): Promise<void>;
  stop(): Promise<void>;
}
