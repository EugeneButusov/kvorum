import type { ExecutorKind } from '@libs/db';
import { buildContainer } from './bootstrap.js';

function resolveExecutor(): { executor: string; executorKind: ExecutorKind } {
  const sudoUser = process.env['SUDO_USER'];
  if (sudoUser != null && sudoUser.length > 0) {
    return { executor: sudoUser, executorKind: 'sudo' };
  }

  if (process.env['SSH_CONNECTION'] != null || process.env['SSH_CLIENT'] != null) {
    return { executor: process.env['USER'] ?? 'unknown', executorKind: 'ssh' };
  }

  const envUser = process.env['USER'] ?? process.env['LOGNAME'];
  if (envUser != null && envUser.length > 0) {
    return { executor: envUser, executorKind: 'env' };
  }

  return { executor: 'unknown', executorKind: 'unknown' };
}

export async function withAudit<T>(
  command: string,
  args: unknown,
  run: () => Promise<T>,
): Promise<T> {
  const { adminAuditRepository } = buildContainer();
  const identity = resolveExecutor();
  const id = await adminAuditRepository.start({
    command,
    args,
    executor: identity.executor,
    executorKind: identity.executorKind,
  });

  try {
    const value = await run();
    await adminAuditRepository.complete({ id, outcome: 'success' });
    return value;
  } catch (error) {
    const details =
      error instanceof Error
        ? { name: error.name, message: redactErrorMessage(error.message) }
        : { name: 'UnknownError', message: redactErrorMessage(String(error)) };
    await adminAuditRepository.complete({ id, outcome: 'failure', error: details });
    throw error;
  }
}

function redactErrorMessage(message: string): string {
  return message
    .replace(/kv_live_[A-Za-z0-9_-]{32}/g, '[REDACTED_API_KEY]')
    .replace(/HMAC_PEPPER_[A-Z_]+/g, '[REDACTED_PEPPER]');
}
