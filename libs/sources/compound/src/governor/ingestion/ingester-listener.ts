import type { EventsListener, Logger } from '@libs/chain';
import type { DlqRepository } from '@libs/db';
import { makeIngesterListener as _makeIngesterListener } from '@sources/core';
import type { ArchiveWriteContext, IngesterListenerOptions } from '@sources/core';
import type { GovernorArchiveWriter } from './archive-writer';
import { decodeCompoundLog } from '../abi/decoder';

export interface IngesterListenerDeps {
  archiveWriter: GovernorArchiveWriter;
  context: ArchiveWriteContext;
  logger: Logger;
  dlqRepo: DlqRepository;
}

export function makeIngesterListener(
  deps: IngesterListenerDeps,
  options: IngesterListenerOptions = {},
): EventsListener {
  return _makeIngesterListener(
    deps,
    (log) => decodeCompoundLog(log, deps.context.sourceType),
    options,
  );
}
