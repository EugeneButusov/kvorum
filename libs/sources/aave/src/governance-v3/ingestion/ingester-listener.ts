import type { EventsListener, Logger } from '@libs/chain';
import type { DlqRepository } from '@libs/db';
import { makeIngesterListener } from '@sources/core';
import type { ArchiveWriteContext, IngesterListenerOptions } from '@sources/core';
import type { AaveGovernanceArchiveWriter } from './archive-writer';
import { decodeAaveGovernanceV3Log } from '../abi/decoder';

export interface AaveGovernanceIngesterListenerDeps {
  archiveWriter: AaveGovernanceArchiveWriter;
  context: ArchiveWriteContext;
  logger: Logger;
  dlqRepo: DlqRepository;
}

export function makeAaveGovernanceIngesterListener(
  deps: AaveGovernanceIngesterListenerDeps,
  options?: IngesterListenerOptions,
): EventsListener {
  return makeIngesterListener(
    deps,
    (log) => decodeAaveGovernanceV3Log(log, deps.context.sourceType),
    options,
  );
}
