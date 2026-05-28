import { Controller, Get, Param, Res } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiParam,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ActorRepository } from '@libs/db';
import { ActorRoutingService } from './actor-routing.service';
import { ActorResponseDto } from './actor.dto';
import { toActorResponseDto } from './actor.mappers';
import { CacheControl } from '../cache/cache-control.decorator';
import { problemException } from '../http/problem-exception';
import { ProblemDto } from '../openapi/openapi.dto';

@ApiTags('actors')
@ApiBearerAuth()
@Controller('v1/actors')
export class ActorsController {
  constructor(
    private readonly routingService: ActorRoutingService,
    private readonly actorRepo: ActorRepository,
  ) {}

  @ApiParam({ name: 'address', type: String })
  @ApiOkResponse({ type: ActorResponseDto })
  @ApiResponse({ status: 301, description: 'Redirect to canonical primary address' })
  @ApiBadRequestResponse({ type: ProblemDto })
  @ApiUnauthorizedResponse({ type: ProblemDto })
  @ApiNotFoundResponse({ type: ProblemDto })
  @Get(':address')
  @CacheControl({ visibility: 'private', maxAgeSecs: 0, mustRevalidate: true })
  async getByAddress(
    @Param('address') rawAddress: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ActorResponseDto | undefined> {
    const result = await this.routingService.resolveAddress(rawAddress);

    if (result.kind === 'redirect') {
      res.status(301);
      res.setHeader('Location', `/v1/actors/${result.survivorPrimaryAddress}`);
      return undefined;
    }

    if (result.kind === 'not-found') {
      throw problemException('actor-not-found', {
        detail: `No actor found for address ${rawAddress.toLowerCase()}`,
      });
    }

    const addresses = await this.actorRepo.listAddressesForActor(result.actor.id);
    return toActorResponseDto(result.actor, addresses);
  }
}
