import type { EventsListener, Logger } from '@libs/chain';
import type { DlqRepository } from '@libs/db';
import { makeIngesterListener } from '@sources/core';
import type { ArchiveWriteContext, IngesterListenerOptions } from '@sources/core';
import type { DelegateRegistryArchiveWriter } from './archive-writer';
import { decodeDelegateRegistryLog } from '../abi/decoder';

export interface DelegateRegistryIngesterListenerDeps {
  archiveWriter: DelegateRegistryArchiveWriter;
  context: ArchiveWriteContext;
  logger: Logger;
  dlqRepo: DlqRepository;
}

export function makeDelegateRegistryIngesterListener(
  deps: DelegateRegistryIngesterListenerDeps,
  options?: IngesterListenerOptions,
): EventsListener {
  return makeIngesterListener(deps, (log) => decodeDelegateRegistryLog(log), options);
}
