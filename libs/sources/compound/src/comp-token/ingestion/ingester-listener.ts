import type { EventsListener, Logger } from '@libs/chain';
import type { DlqRepository } from '@libs/db';
import { makeIngesterListener } from '@sources/core';
import type { ArchiveWriteContext, IngesterListenerOptions } from '@sources/core';
import type { CompTokenArchiveWriter } from './archive-writer';
import { decodeCompTokenLog } from '../abi/decoder';

export interface CompTokenIngesterListenerDeps {
  archiveWriter: CompTokenArchiveWriter;
  context: ArchiveWriteContext;
  logger: Logger;
  dlqRepo: DlqRepository;
}

export function makeCompTokenIngesterListener(
  deps: CompTokenIngesterListenerDeps,
  options?: IngesterListenerOptions,
): EventsListener {
  return makeIngesterListener(deps, (log) => decodeCompTokenLog(log), options);
}
