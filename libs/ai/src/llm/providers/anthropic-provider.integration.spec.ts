import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createAnthropicProvider } from './anthropic-provider.js';
import { toStrippedJsonSchema } from '../schema.js';

const API_KEY = process.env['ANTHROPIC_API_KEY'];
const describeIf = API_KEY ? describe : describe.skip;

describeIf('AnthropicProvider (live)', () => {
  it('accepts a stripped Zod schema and returns validating JSON', async () => {
    const provider = createAnthropicProvider({ apiKey: API_KEY as string });
    const schema = z.object({ answer: z.string().max(40) });

    const res = await provider.completeStructured({
      model: 'claude-haiku-4-5',
      messages: [
        { role: 'user', content: 'Reply with the capital of France as {"answer": "..."}.' },
      ],
      jsonSchema: toStrippedJsonSchema(schema),
      mode: 'sync',
    });

    expect(schema.safeParse(res.parsed).success).toBe(true);
    expect(res.cost.totalUsd).toBeGreaterThan(0);
  }, 30_000);
});
