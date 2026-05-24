import { Injectable } from '@nestjs/common';
import type { Actor } from '@libs/db';
import { ActorRoutingReadRepository } from '@libs/db';
import { badRequestProblem } from '../http/problem-exception';

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

export type ActorRoutingResult =
  | { kind: 'ok'; actor: Actor }
  | { kind: 'redirect'; survivorPrimaryAddress: string }
  | { kind: 'not-found' };

@Injectable()
export class ActorRoutingService {
  constructor(private readonly repo: ActorRoutingReadRepository) {}

  async resolveAddress(rawAddress: string): Promise<ActorRoutingResult> {
    if (!ADDRESS_PATTERN.test(rawAddress)) {
      throw badRequestProblem('validation', [
        { field: 'address', message: 'must be 0x + 40 hex characters' },
      ]);
    }

    const address = rawAddress.toLowerCase();

    const liveActor = await this.repo.findLiveActorByPrimaryAddress(address);
    if (liveActor !== undefined) {
      return { kind: 'ok', actor: liveActor };
    }

    const redirect = await this.repo.findRedirect(address);
    if (redirect !== undefined) {
      return {
        kind: 'redirect',
        survivorPrimaryAddress: redirect.survivor_primary_address,
      };
    }

    const byAnyAddress = await this.repo.findLiveActorByAnyAddress(address);
    if (byAnyAddress !== undefined) {
      return {
        kind: 'redirect',
        survivorPrimaryAddress: byAnyAddress.primary_address,
      };
    }

    return { kind: 'not-found' };
  }
}
