import type { EventsListener, Logger } from '@libs/chain';
import type { DlqRepository } from '@libs/db';
import { makeIngesterListener } from '@sources/core';
import type { ArchiveWriteContext, IngesterListenerOptions } from '@sources/core';
import type { GovernorArchiveWriter } from './archive-writer';
import { decodeCompoundLog } from '../abi/decoder';

export interface IngesterListenerDeps {
  archiveWriter: GovernorArchiveWriter;
  context: ArchiveWriteContext;
  logger: Logger;
  dlqRepo: DlqRepository;
}

export function makeGovernorIngesterListener(
  deps: IngesterListenerDeps,
  options: IngesterListenerOptions = {},
): EventsListener {
  return makeIngesterListener(
    deps,
    (log) => decodeCompoundLog(log, deps.context.sourceType),
    options,
  );
}
