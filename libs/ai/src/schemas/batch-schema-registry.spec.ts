import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { BatchSchemaRegistry } from './batch-schema-registry.js';

describe('BatchSchemaRegistry', () => {
  it('resolves a registered schema by feature and prompt version', () => {
    const schema = z.object({ value: z.string() });
    const registry = new BatchSchemaRegistry([{ feature: 'example', promptVersion: 'v1', schema }]);

    expect(registry.get('example', 'v1')).toBe(schema);
  });

  it('keeps schema versions independent', () => {
    const v1 = z.object({ old: z.string() });
    const v2 = z.object({ current: z.string() });
    const registry = new BatchSchemaRegistry([
      { feature: 'example', promptVersion: 'v1', schema: v1 },
      { feature: 'example', promptVersion: 'v2', schema: v2 },
    ]);

    expect(registry.get('example', 'v1')).toBe(v1);
    expect(registry.get('example', 'v2')).toBe(v2);
  });

  it('rejects duplicate registrations', () => {
    const schema = z.object({ value: z.string() });
    expect(
      () =>
        new BatchSchemaRegistry([
          { feature: 'example', promptVersion: 'v1', schema },
          { feature: 'example', promptVersion: 'v1', schema },
        ]),
    ).toThrow('Duplicate batch output schema');
  });

  it('rejects an unregistered durable feature/version pair', () => {
    const registry = new BatchSchemaRegistry();
    expect(() => registry.get('unknown', 'v1')).toThrow(
      'No batch output schema registered for feature "unknown" and prompt version "v1"',
    );
  });
});
