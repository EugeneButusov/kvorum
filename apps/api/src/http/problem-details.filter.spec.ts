import { HttpException, NotFoundException } from '@nestjs/common';
import { ZodError, z } from 'zod';
import { ProblemDetailsFilter } from './problem-details.filter';
import { ProblemException } from './problem-exception';
import { slugFromHttpStatus } from './problem-types';

type ResponseMock = {
  headersSent: boolean;
  status: ReturnType<typeof vi.fn>;
  setHeader: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
};

function createResponse(headersSent = false): ResponseMock {
  const response: ResponseMock = {
    headersSent,
    status: vi.fn(),
    setHeader: vi.fn(),
    json: vi.fn(),
  };
  response.status.mockReturnValue(response);
  response.setHeader.mockReturnValue(response);
  return response;
}

function createHost(response: ResponseMock, path: string) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ path }),
      getResponse: () => response,
    }),
  };
}

describe('ProblemDetailsFilter', () => {
  it('maps ProblemException and preserves provided detail/violations', () => {
    const filter = new ProblemDetailsFilter();
    const response = createResponse();

    filter.catch(
      new ProblemException('unknown-filter', 400, 'bad filter', [{ field: 'q', message: 'nope' }]),
      createHost(response, '/items') as never,
    );

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.setHeader).toHaveBeenCalledWith('Content-Type', 'application/problem+json');
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'urn:error:unknown-filter',
        detail: 'bad filter',
        instance: '/items',
        violations: [{ field: 'q', message: 'nope' }],
      }),
    );
  });

  it('maps ZodError to validation violations with root/nested path handling', () => {
    const filter = new ProblemDetailsFilter();
    const response = createResponse();

    const schema = z.object({ user: z.object({ age: z.number().min(18) }) });
    const result = schema.safeParse({ user: { age: 10 } });
    if (result.success) {
      throw new Error('Expected parse failure');
    }

    filter.catch(result.error, createHost(response, '/users') as never);

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'urn:error:validation',
        violations: expect.arrayContaining([{ field: 'user.age', message: expect.any(String) }]),
      }),
    );
  });

  it('maps built-in HttpException from status', () => {
    const filter = new ProblemDetailsFilter();
    const response = createResponse();

    filter.catch(new NotFoundException('missing'), createHost(response, '/missing?x=1') as never);

    expect(response.status).toHaveBeenCalledWith(404);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'urn:error:not-found',
        instance: '/missing?x=1',
      }),
    );
  });

  it('suppresses detail on unknown internal errors', () => {
    const filter = new ProblemDetailsFilter();
    const response = createResponse();

    filter.catch(new Error('secret stack detail'), createHost(response, '/oops') as never);

    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'urn:error:internal-error',
        detail: 'An unexpected error occurred.',
      }),
    );
    expect(JSON.stringify(response.json.mock.calls[0][0])).not.toContain('secret stack detail');
  });

  it('returns early when headers are already sent', () => {
    const filter = new ProblemDetailsFilter();
    const response = createResponse(true);

    filter.catch(new HttpException('late', 400), createHost(response, '/late') as never);

    expect(response.status).not.toHaveBeenCalled();
    expect(response.setHeader).not.toHaveBeenCalled();
    expect(response.json).not.toHaveBeenCalled();
  });

  it('uses (root) for root-level zod issues', () => {
    const filter = new ProblemDetailsFilter();
    const response = createResponse();
    const error = new ZodError([
      {
        code: 'custom',
        message: 'root issue',
        path: [],
        input: undefined,
      },
    ]);

    filter.catch(error, createHost(response, '/root') as never);

    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        violations: [{ field: '(root)', message: 'root issue' }],
      }),
    );
  });

  it('uses title as detail when ProblemException has no explicit detail', () => {
    const filter = new ProblemDetailsFilter();
    const response = createResponse();

    filter.catch(new ProblemException('not-found', 404), createHost(response, '/x') as never);

    const body = response.json.mock.calls[0]?.[0] as { title: string; detail: string };
    expect(body.detail).toBe(body.title);
  });

  it('logs and suppresses detail on 5xx HttpException', () => {
    const filter = new ProblemDetailsFilter();
    const response = createResponse();

    filter.catch(new HttpException('crash', 500), createHost(response, '/crash') as never);

    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ detail: 'An unexpected error occurred.' }),
    );
  });

  it('uses string response body as detail', () => {
    const filter = new ProblemDetailsFilter();
    const response = createResponse();

    filter.catch(new HttpException('plain string', 400), createHost(response, '/foo') as never);

    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ detail: 'plain string' }));
  });

  it('maps 401 to unauthorized', () => {
    const filter = new ProblemDetailsFilter();
    const response = createResponse();
    filter.catch(new HttpException('unauthorized', 401), createHost(response, '/secure') as never);
    expect(response.status).toHaveBeenCalledWith(401);
  });

  it('maps 503 to service-unavailable', () => {
    const filter = new ProblemDetailsFilter();
    const response = createResponse();
    filter.catch(new HttpException('unavailable', 503), createHost(response, '/svc') as never);
    expect(response.status).toHaveBeenCalledWith(503);
  });

  it('maps 429 to rate-limited', () => {
    const filter = new ProblemDetailsFilter();
    const response = createResponse();
    filter.catch(new HttpException('too many', 429), createHost(response, '/rl') as never);
    expect(response.status).toHaveBeenCalledWith(429);
  });

  it('falls back to exception.message for non-string non-object response', () => {
    const filter = new ProblemDetailsFilter();
    const response = createResponse();

    const ex = new HttpException({ code: 42 }, 400);
    filter.catch(ex, createHost(response, '/foo') as never);

    expect(response.status).toHaveBeenCalledWith(400);
    const body = response.json.mock.calls[0]?.[0] as { detail: string };
    expect(typeof body.detail).toBe('string');
  });

  it('falls back to exception.message when response.message is not a string', () => {
    const filter = new ProblemDetailsFilter();
    const response = createResponse();

    const ex = new HttpException({ message: [1, 2, 3] }, 400);
    filter.catch(ex, createHost(response, '/foo') as never);

    expect(response.status).toHaveBeenCalledWith(400);
    const body = response.json.mock.calls[0]?.[0] as { detail: string };
    expect(typeof body.detail).toBe('string');
  });
});

describe('slugFromHttpStatus', () => {
  it.each([
    [400, 'validation'],
    [401, 'unauthorized'],
    [404, 'not-found'],
    [429, 'rate-limited'],
    [503, 'service-unavailable'],
    [500, 'internal-error'],
    [502, 'internal-error'],
    [300, 'validation'],
  ])('maps %i → %s', (status, expected) => {
    expect(slugFromHttpStatus(status)).toBe(expected);
  });
});
