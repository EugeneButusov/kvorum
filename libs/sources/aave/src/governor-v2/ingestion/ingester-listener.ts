import type { EventsListener, Logger } from '@libs/chain';
import type { DlqRepository } from '@libs/db';
import { makeIngesterListener } from '@sources/core';
import type { ArchiveWriteContext, IngesterListenerOptions } from '@sources/core';
import type { AaveGovernorV2ArchiveWriter } from './archive-writer';
import { decodeAaveGovernorV2Log } from '../abi/decoder';

export interface AaveGovernorV2IngesterListenerDeps {
  archiveWriter: AaveGovernorV2ArchiveWriter;
  context: ArchiveWriteContext;
  logger: Logger;
  dlqRepo: DlqRepository;
}

export function makeAaveGovernorV2IngesterListener(
  deps: AaveGovernorV2IngesterListenerDeps,
  options?: IngesterListenerOptions,
): EventsListener {
  return makeIngesterListener(
    deps,
    (log) => decodeAaveGovernorV2Log(log, deps.context.sourceType),
    options,
  );
}
