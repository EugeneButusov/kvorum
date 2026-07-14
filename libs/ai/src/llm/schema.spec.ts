import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { toStrippedJsonSchema } from './schema.js';

describe('toStrippedJsonSchema', () => {
  it('keeps structure but strips unsupported constraint keywords', () => {
    const schema = z.object({
      tldr: z.string().max(280),
      tags: z.array(z.string()).max(5),
      score: z.number().min(0).max(100),
    });

    const json = JSON.stringify(toStrippedJsonSchema(schema));

    // structural keywords survive
    expect(json).toContain('"type":"object"');
    expect(json).toContain('"tldr"');
    expect(json).toContain('"tags"');
    // constraint keywords are gone
    expect(json).not.toContain('maxLength');
    expect(json).not.toContain('minimum');
    expect(json).not.toContain('maximum');
    expect(json).not.toContain('maxItems');
  });

  it('strips nested constraints too', () => {
    const schema = z.object({ inner: z.object({ code: z.string().min(2).max(10) }) });
    expect(JSON.stringify(toStrippedJsonSchema(schema))).not.toContain('maxLength');
  });
});
