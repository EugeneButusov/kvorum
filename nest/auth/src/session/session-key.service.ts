import { DASHBOARD_KEY_PREFIX, generateApiKey, hashApiKey, type PepperSet } from '@libs/auth';
import { ApiKeyRepository } from '@libs/db';
import { SESSION_TTL_SECONDS } from './session.config';

// Mints and revokes the API key that belongs to a session (ADR-035): a privileged key provisioned
// when a session is created and revoked when it ends. It carries an expires_at equal to the session
// lifetime, so a session that lapses by TTL (no explicit logout) can't leave a live key behind.
export class SessionKeyService {
  constructor(
    private readonly keys: ApiKeyRepository,
    private readonly peppers: PepperSet,
  ) {}

  async provision(userId: string): Promise<{ id: string; key: string }> {
    const generated = generateApiKey(DASHBOARD_KEY_PREFIX);
    const created = await this.keys.create({
      userId,
      keyHash: hashApiKey(this.peppers.current, generated.key),
      prefix: generated.prefix,
      lastFour: generated.lastFour,
      tier: 'dashboard',
      expiresAt: new Date(Date.now() + SESSION_TTL_SECONDS * 1000),
    });
    return { id: created.id, key: generated.key };
  }

  async revoke(keyId: string): Promise<void> {
    await this.keys.revoke(keyId);
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.keys.revokeActiveDashboardKeysForUser(userId);
  }
}
