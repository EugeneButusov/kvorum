import type { ArchiveEventType } from '@libs/domain';

export type ActorAddressSource = 'voter_event' | 'delegator_event' | 'delegate_event';

export interface AddressCandidate {
  address: string;
  source: ActorAddressSource;
}

export interface ActorSweepExtractor {
  sourceTypes: readonly string[];
  eventTypes: readonly ArchiveEventType[];
  extractAddresses(eventType: ArchiveEventType, payloadJson: string): AddressCandidate[];
}

export const COMPOUND_ACTOR_SWEEP_EXTRACTOR: ActorSweepExtractor = {
  sourceTypes: [
    'compound_governor_alpha',
    'compound_governor_bravo',
    'compound_governor_oz',
    'compound_comp_token',
  ],
  eventTypes: ['VoteCast', 'DelegateChanged', 'DelegateVotesChanged'],
  extractAddresses(eventType: string, payloadJson: string): AddressCandidate[] {
    const payload = JSON.parse(payloadJson) as Record<string, unknown>;
    switch (eventType) {
      case 'VoteCast':
        return [asAddress(payload['voter'], 'voter_event')];
      case 'DelegateChanged':
        return [
          asAddress(payload['delegator'], 'delegator_event'),
          asAddress(payload['fromDelegate'], 'delegate_event'),
          asAddress(payload['toDelegate'], 'delegate_event'),
        ];
      case 'DelegateVotesChanged':
        return [asAddress(payload['delegate'], 'delegate_event')];
      default:
        throw new Error(`unsupported event_type for actor sweep: ${eventType}`);
    }
  },
};

function asAddress(raw: unknown, source: ActorAddressSource): AddressCandidate {
  if (typeof raw !== 'string' || !raw.startsWith('0x') || raw.length !== 42) {
    throw new Error(`invalid address payload field for source ${source}`);
  }
  return { address: raw, source };
}
