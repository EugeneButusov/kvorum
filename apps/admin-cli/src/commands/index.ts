import { Command } from 'commander';

type Registrar = (program: Command) => void;
type Loader = () => Promise<{ register: Registrar }>;

const COMMAND_LOADERS: Record<string, Loader> = {
  actor: async () => ({ register: (await import('./actor.js')).registerActor }),
  ai: async () => ({ register: (await import('./ai.js')).registerAi }),
  audit: async () => ({ register: (await import('./audit.js')).registerAudit }),
  backfill: async () => ({ register: (await import('./backfill.js')).registerBackfill }),
  dao: async () => ({ register: (await import('./dao.js')).registerDao }),
  derive: async () => ({ register: (await import('./derive.js')).registerDerive }),
  dlq: async () => ({ register: (await import('./dlq.js')).registerDlq }),
  ens: async () => ({ register: (await import('./ens.js')).registerEns }),
  keys: async () => ({ register: (await import('./keys.js')).registerKeys }),
  maintenance: async () => ({ register: (await import('./maintenance.js')).registerMaintenance }),
  snapshot: async () => ({ register: (await import('./snapshot.js')).registerSnapshot }),
  status: async () => ({ register: (await import('./status.js')).registerStatus }),
  user: async () => ({ register: (await import('./user.js')).registerUser }),
};

export async function registerCommands(program: Command, topLevelCommand?: string): Promise<void> {
  if (topLevelCommand !== undefined && topLevelCommand in COMMAND_LOADERS) {
    const loaded = await COMMAND_LOADERS[topLevelCommand]!();
    loaded.register(program);
    return;
  }

  for (const load of Object.values(COMMAND_LOADERS)) {
    const loaded = await load();
    loaded.register(program);
  }
}
