import { applyDecorators } from '@nestjs/common';
import { ApiQuery } from '@nestjs/swagger';
import type { EndpointQuery } from '../query/query-descriptor';

/**
 * Document an endpoint's query parameters from the same {@link EndpointQuery} descriptor its parser
 * enforces, so the published OpenAPI cannot advertise a filter the endpoint rejects.
 *
 * It could before. `ApiListQueryDto` carried a hand-written filter list and was reused by eight
 * controllers, so it documented the `/v1/proposals` filters everywhere — accurate for that one
 * endpoint and wrong for the rest. A client following the schema got `400 unknown filter parameter`
 * from `/v1/actors/{address}/votes?dao=…` and `/v1/daos?state=…`, among others.
 *
 * The universal three (`limit`, `cursor`, `sort`) stay on the shared DTO; only `sort`'s allowed
 * fields are endpoint-specific, so they are listed here too.
 */
export function ApiEndpointQuery(query: EndpointQuery): MethodDecorator {
  const sortable = Object.keys(query.sortable);
  const decorators = [
    ApiQuery({
      name: 'sort',
      required: false,
      type: String,
      description:
        sortable.length === 0
          ? 'Not sortable.'
          : `Comma-delimited sort fields (prefix with - for desc). Allowed: ${sortable.join(', ')}.`,
    }),
    ...Object.entries(query.filters).map(([name, filter]) =>
      ApiQuery({
        name,
        required: false,
        type:
          filter.docType === 'number' ? Number : filter.docType === 'boolean' ? Boolean : String,
        description:
          filter.doc ?? (filter.multi === true ? `Comma-delimited ${name} values` : undefined),
      }),
    ),
  ];

  return applyDecorators(...decorators);
}
