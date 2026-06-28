import type { EventsListener, Logger } from '@libs/chain';
import type { DlqRepository } from '@libs/db';
import { makeIngesterListener } from '@sources/core';
import type { ArchiveWriteContext, IngesterListenerOptions } from '@sources/core';
import type { LidoEasyTrackArchiveWriter } from './archive-writer';
import { decodeEasyTrackLog } from '../abi/decoder';

export interface EasyTrackIngesterListenerDeps {
  archiveWriter: LidoEasyTrackArchiveWriter;
  context: ArchiveWriteContext;
  logger: Logger;
  dlqRepo: DlqRepository;
}

export function makeEasyTrackIngesterListener(
  deps: EasyTrackIngesterListenerDeps,
  options?: IngesterListenerOptions,
): EventsListener {
  return makeIngesterListener(
    deps,
    (log) => decodeEasyTrackLog(log, deps.context.sourceType),
    options,
  );
}
