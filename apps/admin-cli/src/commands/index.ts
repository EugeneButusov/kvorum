import { Command } from 'commander';
import { registerActor } from './actor.js';
import { registerAi } from './ai.js';
import { registerAudit } from './audit.js';
import { registerBackfill } from './backfill.js';
import { registerDao } from './dao.js';
import { registerDerive } from './derive.js';
import { registerDlq } from './dlq.js';
import { registerKeys } from './keys.js';
import { registerMaintenance } from './maintenance.js';
import { registerSnapshot } from './snapshot.js';
import { registerStatus } from './status.js';
import { registerUser } from './user.js';

export function registerAllCommands(program: Command): void {
  registerActor(program);
  registerAi(program);
  registerAudit(program);
  registerBackfill(program);
  registerDao(program);
  registerDerive(program);
  registerDlq(program);
  registerKeys(program);
  registerMaintenance(program);
  registerStatus(program);
  registerSnapshot(program);
  registerUser(program);
}
