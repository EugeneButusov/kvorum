import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * The query parameters every list endpoint accepts.
 *
 * Filters are NOT declared here. They differ per endpoint and are documented from each endpoint's
 * `EndpointQuery` descriptor via `@ApiEndpointQuery`, which is the same declaration the parser
 * enforces. This class previously carried the `/v1/proposals` filter set and was reused by eight
 * controllers, so the published schema advertised filters most of them reject.
 *
 * `sort` is documented per endpoint too (its allowed fields vary), so it is omitted here.
 */
export class ApiListQueryDto {
  @ApiPropertyOptional({ type: Number })
  declare limit?: number;

  @ApiPropertyOptional()
  declare cursor?: string;
}
