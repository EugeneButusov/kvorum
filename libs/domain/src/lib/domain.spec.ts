import { describe, expect, it } from 'vitest';
import { KVORUM_VERSION } from './domain';

describe('domain', () => {
  it('exports KVORUM_VERSION', () => {
    expect(typeof KVORUM_VERSION).toBe('string');
  });
});
