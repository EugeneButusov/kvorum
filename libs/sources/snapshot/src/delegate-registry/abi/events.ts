import { Interface } from 'ethers';

// Gnosis "Delegate Registry". Both events carry three indexed params, so the space `id`
// (topic[2]) is topic-filterable. `id` is the space name as bytes32 (ascii, right-zero-padded);
// id == 0x0 is the GLOBAL scope. A single delegate per (delegator, id); ClearDelegate removes it.
const SET_DELEGATE =
  'event SetDelegate(address indexed delegator, bytes32 indexed id, address indexed delegate)';
const CLEAR_DELEGATE =
  'event ClearDelegate(address indexed delegator, bytes32 indexed id, address indexed delegate)';

export const DELEGATE_REGISTRY_INTERFACE = new Interface([SET_DELEGATE, CLEAR_DELEGATE]);

export const DELEGATE_REGISTRY_TOPICS = {
  SetDelegate: DELEGATE_REGISTRY_INTERFACE.getEvent('SetDelegate')!.topicHash.toLowerCase(),
  ClearDelegate: DELEGATE_REGISTRY_INTERFACE.getEvent('ClearDelegate')!.topicHash.toLowerCase(),
} as const;

export type DelegateRegistryEventType = 'SetDelegate' | 'ClearDelegate';
