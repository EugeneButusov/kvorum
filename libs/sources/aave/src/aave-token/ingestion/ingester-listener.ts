import type { EventsListener, Logger } from '@libs/chain';
import type { DlqRepository } from '@libs/db';
import { makeIngesterListener } from '@sources/core';
import type { ArchiveWriteContext, IngesterListenerOptions } from '@sources/core';
import type { AaveTokenArchiveWriter } from './archive-writer';
import { decodeAaveTokenLog } from '../abi/decoder';

export interface AaveTokenIngesterListenerDeps {
  archiveWriter: AaveTokenArchiveWriter;
  context: ArchiveWriteContext;
  logger: Logger;
  dlqRepo: DlqRepository;
}

export function makeAaveTokenIngesterListener(
  deps: AaveTokenIngesterListenerDeps,
  options?: IngesterListenerOptions,
): EventsListener {
  return makeIngesterListener(deps, (log) => decodeAaveTokenLog(log), options);
}
