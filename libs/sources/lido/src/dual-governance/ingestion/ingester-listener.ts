import type { EventsListener, Logger } from '@libs/chain';
import type { DlqRepository } from '@libs/db';
import { makeIngesterListener } from '@sources/core';
import type { ArchiveWriteContext, IngesterListenerOptions } from '@sources/core';
import type { LidoDualGovernanceArchiveWriter } from './archive-writer';
import { decodeDualGovernanceLog } from '../abi/decoder';

export interface DualGovernanceIngesterListenerDeps {
  archiveWriter: LidoDualGovernanceArchiveWriter;
  context: ArchiveWriteContext;
  logger: Logger;
  dlqRepo: DlqRepository;
}

export function makeDualGovernanceIngesterListener(
  deps: DualGovernanceIngesterListenerDeps,
  options?: IngesterListenerOptions,
): EventsListener {
  return makeIngesterListener(
    deps,
    (log) => decodeDualGovernanceLog(log, deps.context.sourceType),
    options,
  );
}
