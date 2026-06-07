import type { EventsListener, Logger } from '@libs/chain';
import type { DlqRepository } from '@libs/db';
import { makeIngesterListener } from '@sources/core';
import type { ArchiveWriteContext, IngesterListenerOptions } from '@sources/core';
import type { AavePayloadsControllerArchiveWriter } from './archive-writer';
import { decodeAavePayloadsControllerLog } from '../abi/decoder';

export interface AavePayloadsControllerIngesterListenerDeps {
  archiveWriter: AavePayloadsControllerArchiveWriter;
  context: ArchiveWriteContext;
  logger: Logger;
  dlqRepo: DlqRepository;
}

export function makeAavePayloadsControllerIngesterListener(
  deps: AavePayloadsControllerIngesterListenerDeps,
  options?: IngesterListenerOptions,
): EventsListener {
  return makeIngesterListener(
    deps,
    (log) => decodeAavePayloadsControllerLog(log, deps.context.sourceType),
    options,
  );
}
