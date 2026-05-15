import { HttpException, NotFoundException } from '@nestjs/common';
import { ZodError, z } from 'zod';
import { ProblemDetailsFilter } from './problem-details.filter';
import { ProblemException } from './problem-exception';

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
        type: 'https://kvorum.example/errors/unknown-filter',
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
        type: 'https://kvorum.example/errors/validation',
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
        type: 'https://kvorum.example/errors/not-found',
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
        type: 'https://kvorum.example/errors/internal-error',
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
});
