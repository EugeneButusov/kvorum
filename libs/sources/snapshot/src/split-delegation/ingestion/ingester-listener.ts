import type { EventsListener, Logger } from '@libs/chain';
import type { DlqRepository } from '@libs/db';
import { makeIngesterListener } from '@sources/core';
import type { ArchiveWriteContext, IngesterListenerOptions } from '@sources/core';
import type { SplitDelegationArchiveWriter } from './archive-writer';
import { decodeSplitDelegationLog } from '../abi/decoder';
import type { SplitDelegationEvent } from '../domain/types';

export interface SplitDelegationIngesterListenerDeps {
  archiveWriter: SplitDelegationArchiveWriter;
  context: ArchiveWriteContext;
  logger: Logger;
  dlqRepo: DlqRepository;
}

export function makeSplitDelegationIngesterListener(
  deps: SplitDelegationIngesterListenerDeps,
  options?: IngesterListenerOptions<SplitDelegationEvent>,
): EventsListener {
  return makeIngesterListener(deps, (log) => decodeSplitDelegationLog(log), options);
}
