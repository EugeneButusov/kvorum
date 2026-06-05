import type { EventsListener, Logger } from '@libs/chain';
import type { DlqRepository } from '@libs/db';
import { makeIngesterListener } from '@sources/core';
import type { ArchiveWriteContext, IngesterListenerOptions } from '@sources/core';
import type { AaveVotingMachineArchiveWriter } from './archive-writer';
import { decodeAaveVotingMachineLog } from '../abi/decoder';

export interface AaveVotingMachineIngesterListenerDeps {
  archiveWriter: AaveVotingMachineArchiveWriter;
  context: ArchiveWriteContext;
  logger: Logger;
  dlqRepo: DlqRepository;
}

export function makeAaveVotingMachineIngesterListener(
  deps: AaveVotingMachineIngesterListenerDeps,
  options?: IngesterListenerOptions,
): EventsListener {
  return makeIngesterListener(
    deps,
    (log) => decodeAaveVotingMachineLog(log, deps.context.sourceType),
    options,
  );
}
