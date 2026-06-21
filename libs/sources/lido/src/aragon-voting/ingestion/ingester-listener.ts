import type { EventsListener, Logger } from '@libs/chain';
import type { DlqRepository } from '@libs/db';
import { makeIngesterListener } from '@sources/core';
import type { ArchiveWriteContext, IngesterListenerOptions } from '@sources/core';
import type { LidoAragonVotingArchiveWriter } from './archive-writer';
import { decodeAragonVotingLog } from '../abi/decoder';

export interface AragonVotingIngesterListenerDeps {
  archiveWriter: LidoAragonVotingArchiveWriter;
  context: ArchiveWriteContext;
  logger: Logger;
  dlqRepo: DlqRepository;
}

export function makeAragonVotingIngesterListener(
  deps: AragonVotingIngesterListenerDeps,
  options?: IngesterListenerOptions,
): EventsListener {
  return makeIngesterListener(
    deps,
    (log) => decodeAragonVotingLog(log, deps.context.sourceType),
    options,
  );
}
