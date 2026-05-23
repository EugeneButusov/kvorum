import type { EventsListener } from '@libs/chain';
import { buildDlqRetryListenerProviders } from '../plugins/dlq-retry-listener-providers.js';

export interface DlqRetryListenerFactoryInput {
  stage: string;
  archiveSourceType: string;
  archiveChainId: string;
  daoSourceId: string;
}

export interface DlqRetryListenerProvider {
  supports(input: DlqRetryListenerFactoryInput): boolean;
  make(input: DlqRetryListenerFactoryInput): Promise<EventsListener>;
}

export async function makeDlqRetryListener(
  input: DlqRetryListenerFactoryInput,
): Promise<EventsListener> {
  for (const provider of buildDlqRetryListenerProviders()) {
    if (provider.supports(input)) return provider.make(input);
  }
  throw new Error(
    `no dlq retry listener provider for stage=${input.stage} source_type=${input.archiveSourceType}`,
  );
}
