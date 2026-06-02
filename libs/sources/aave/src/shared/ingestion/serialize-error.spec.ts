import { describe, expect, it } from 'vitest';
import { serializeError } from './serialize-error';

describe('serializeError', () => {
  it('serializes Error instances with optional code', () => {
    const err = Object.assign(new Error('boom'), { code: 'E_TEST' });

    expect(serializeError(err)).toMatchObject({
      name: 'Error',
      message: 'boom',
      code: 'E_TEST',
    });
  });

  it('serializes unknown values', () => {
    expect(serializeError('boom')).toEqual({
      name: 'UnknownError',
      message: 'boom',
    });
  });
});
