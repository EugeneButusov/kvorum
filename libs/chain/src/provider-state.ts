import { CircuitBreaker } from './circuit-breaker.js';

export interface ProviderState {
  name: string;
  circuit: CircuitBreaker;
  verified: boolean;
  deprioritized: boolean;
  unusable: boolean;
  lastBlockNumber: bigint | null;
  lastHealthCheckAt: Date | null;
  consecutiveHealthFailures: number;
}

export function createProviderState(name: string): ProviderState {
  return {
    name,
    circuit: new CircuitBreaker(),
    verified: false,
    deprioritized: false,
    unusable: false,
    lastBlockNumber: null,
    lastHealthCheckAt: null,
    consecutiveHealthFailures: 0,
  };
}
