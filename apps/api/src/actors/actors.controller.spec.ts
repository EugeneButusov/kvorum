import { describe, expect, it, vi } from 'vitest';
import type { Response } from 'express';
import { ProblemException } from '../http/problem-exception';
import { ActorsController } from './actors.controller';

function mockResponse(): Response {
  const res = {
    status: vi.fn(),
    setHeader: vi.fn(),
  };
  return res as unknown as Response;
}

describe('ActorsController', () => {
  it('returns dto on ok result', async () => {
    const routing = {
      resolveAddress: vi.fn().mockResolvedValue({
        kind: 'ok',
        actor: {
          id: 'actor-1',
          primary_address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          display_name: 'Alice',
        },
      }),
    };
    const controller = new ActorsController(routing as never);
    const res = mockResponse();

    await expect(
      controller.getByAddress('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', res),
    ).resolves.toEqual({
      data: {
        actor_id: 'actor-1',
        primary_address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        display_name: 'Alice',
      },
    });

    expect(res.status).not.toHaveBeenCalled();
    expect(res.setHeader).not.toHaveBeenCalled();
  });

  it('returns 301 with Location header on redirect result', async () => {
    const routing = {
      resolveAddress: vi.fn().mockResolvedValue({
        kind: 'redirect',
        survivorPrimaryAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      }),
    };
    const controller = new ActorsController(routing as never);
    const res = mockResponse();

    await expect(
      controller.getByAddress('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', res),
    ).resolves.toBeUndefined();

    expect(res.status).toHaveBeenCalledWith(301);
    expect(res.setHeader).toHaveBeenCalledWith(
      'Location',
      '/v1/actors/0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    );
  });

  it('throws actor-not-found problem for not-found result', async () => {
    const routing = {
      resolveAddress: vi.fn().mockResolvedValue({ kind: 'not-found' }),
    };
    const controller = new ActorsController(routing as never);

    await expect(
      controller.getByAddress('0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', mockResponse()),
    ).rejects.toBeInstanceOf(ProblemException);
  });
});
