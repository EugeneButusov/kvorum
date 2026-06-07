import { Interface } from 'ethers';

const PAYLOADS_CONTROLLER_EVENTS = [
  'event PayloadCreated(uint40 indexed payloadId, address indexed creator, (address target, bool withDelegateCall, uint8 accessLevel, uint256 value, string signature, bytes callData)[] actions, uint8 indexed maximumAccessLevelRequired)',
  'event PayloadQueued(uint40 payloadId)',
  'event PayloadExecuted(uint40 payloadId)',
  'event PayloadCancelled(uint40 payloadId)',
] as const;

export const AAVE_PAYLOADS_CONTROLLER_INTERFACE = new Interface([...PAYLOADS_CONTROLLER_EVENTS]);

function buildTopics(iface: Interface) {
  return {
    PayloadCreated: iface.getEvent('PayloadCreated')!.topicHash.toLowerCase(),
    PayloadQueued: iface.getEvent('PayloadQueued')!.topicHash.toLowerCase(),
    PayloadExecuted: iface.getEvent('PayloadExecuted')!.topicHash.toLowerCase(),
    PayloadCancelled: iface.getEvent('PayloadCancelled')!.topicHash.toLowerCase(),
  } as const;
}

export const AAVE_PAYLOADS_CONTROLLER_TOPICS = buildTopics(AAVE_PAYLOADS_CONTROLLER_INTERFACE);

export type AavePayloadsControllerEventType =
  | 'PayloadCreated'
  | 'PayloadQueued'
  | 'PayloadExecuted'
  | 'PayloadCancelled';

export type AavePayloadsControllerTopics = ReturnType<typeof buildTopics>;

export function interfaceForAavePayloadsController(): {
  iface: Interface;
  topics: AavePayloadsControllerTopics;
} {
  return {
    iface: AAVE_PAYLOADS_CONTROLLER_INTERFACE,
    topics: AAVE_PAYLOADS_CONTROLLER_TOPICS,
  };
}
