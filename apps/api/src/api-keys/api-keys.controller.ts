import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { generateApiKey, hashApiKey, type PepperSet } from '@libs/auth';
import { ApiKeyRepository, type SafeApiKey, type User } from '@libs/db';
import { AUTH_CONFIG, Public, SessionGuard, SessionUser } from '@nest/auth';
import { CreateKeyDto } from './api-keys.dto';

// A rotated key stays valid for this long so in-flight callers can swap over (SPEC §4.3: ≤24h).
const ROTATION_GRACE_MS = 24 * 60 * 60 * 1000;

type KeyView = {
  id: string;
  prefix: string;
  last_four: string;
  label: string | null;
  created_at: Date;
  last_used_at: Date | null;
  status: 'active' | 'expiring' | 'revoked';
};

// API key management (SPEC §6.13, the developer dashboard). Session-authenticated (cookie), @Public()
// to skip the global ApiKeyGuard. Only the user's own kv_live_ keys are visible/manageable; any
// dashboard-tier key (internal infrastructure) is hidden here. @ApiExcludeController until the
// unified OpenAPI regen.
@ApiExcludeController()
@Public()
@UseGuards(SessionGuard)
@Controller('v1/keys')
export class ApiKeysController {
  constructor(
    private readonly keys: ApiKeyRepository,
    @Inject(AUTH_CONFIG) private readonly peppers: PepperSet,
  ) {}

  @Post()
  async create(
    @SessionUser() user: User,
    @Body() body: CreateKeyDto,
  ): Promise<KeyView & { key: string }> {
    const generated = generateApiKey();
    const created = await this.keys.create({
      userId: user.id,
      keyHash: hashApiKey(this.peppers.current, generated.key),
      prefix: generated.prefix,
      lastFour: generated.lastFour,
      label: body.label,
      tier: 'authenticated_free',
    });
    // The full key is returned exactly once — only the hash + last-4 are stored.
    return { ...view(created), key: generated.key };
  }

  @Get()
  async list(@SessionUser() user: User): Promise<{ data: KeyView[] }> {
    const rows = (await this.keys.listByUser(user.id)).filter((k) => k.tier !== 'dashboard');
    return { data: rows.map(view) };
  }

  @Post(':id/rotate')
  async rotate(
    @SessionUser() user: User,
    @Param('id') id: string,
  ): Promise<KeyView & { key: string }> {
    const existing = await this.ownedKey(id, user.id);
    const generated = generateApiKey();
    const created = await this.keys.create({
      userId: user.id,
      keyHash: hashApiKey(this.peppers.current, generated.key),
      prefix: generated.prefix,
      lastFour: generated.lastFour,
      label: existing.label ?? undefined,
      tier: 'authenticated_free',
    });
    await this.keys.expireAt(existing.id, new Date(Date.now() + ROTATION_GRACE_MS));
    return { ...view(created), key: generated.key };
  }

  @Delete(':id')
  async revoke(@SessionUser() user: User, @Param('id') id: string): Promise<{ ok: true }> {
    const existing = await this.ownedKey(id, user.id);
    await this.keys.revoke(existing.id);
    return { ok: true };
  }

  // Resolves a key the session user owns; dashboard-tier (internal) keys are treated as not found.
  private async ownedKey(id: string, userId: string): Promise<SafeApiKey> {
    const key = await this.keys.findByIdForUser(id, userId);
    if (key === undefined || key.tier === 'dashboard') {
      throw new NotFoundException('Key not found');
    }
    return key;
  }
}

function view(key: SafeApiKey): KeyView {
  const status: KeyView['status'] =
    key.revoked_at !== null ? 'revoked' : key.expires_at !== null ? 'expiring' : 'active';
  return {
    id: key.id,
    prefix: key.prefix,
    last_four: key.last_four,
    label: key.label,
    created_at: key.created_at,
    last_used_at: key.last_used_at,
    status,
  };
}
