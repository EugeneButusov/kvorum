import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { render } from './renderer.js';
import { PromptRenderError, type PromptTemplate } from './types.js';

const schema = z.object({ answer: z.string() });

function template(overrides: Partial<PromptTemplate> = {}): PromptTemplate {
  return {
    name: 'fixture_greeting',
    version: 'v1.0',
    model: 'claude-haiku-4-5',
    schema,
    description: 'fixture',
    body: 'Hello {{name}}, welcome to {{place}}.',
    ...overrides,
  };
}

describe('render', () => {
  it('interpolates vars and stamps provenance fields', () => {
    const r = render(template(), { name: 'Ada', place: 'Kvorum' });
    expect(r.messages).toEqual([{ role: 'user', content: 'Hello Ada, welcome to Kvorum.' }]);
    expect(r.feature).toBe('fixture_greeting');
    expect(r.promptVersion).toBe('v1.0');
    expect(r.model).toBe('claude-haiku-4-5');
    expect(r.schema).toBe(schema);
  });

  it('throws PromptRenderError naming every missing var', () => {
    try {
      render(template(), { name: 'Ada' });
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(PromptRenderError);
      expect((err as PromptRenderError).missingKeys).toEqual(['place']);
    }
  });

  it('collects all missing vars, sorted, when multiple are absent', () => {
    try {
      render(template({ body: '{{a}} {{b}} {{c}}' }), { b: 'x' });
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(PromptRenderError);
      expect((err as PromptRenderError).missingKeys).toEqual(['a', 'c']);
    }
  });

  it('ignores extra provided vars', () => {
    const r = render(template(), { name: 'Ada', place: 'Kvorum', unused: 'x' });
    expect(r.messages[0]?.content).toBe('Hello Ada, welcome to Kvorum.');
  });

  it('emits canonical inputContent stable across key order', () => {
    const a = render(template(), { name: 'Ada', place: 'Kvorum' });
    const b = render(template(), { place: 'Kvorum', name: 'Ada' });
    expect(a.inputContent).toBe(b.inputContent);
    expect(a.inputContent).toBe('{"name":"Ada","place":"Kvorum"}');
  });

  it('is pure — identical vars produce deep-equal output', () => {
    const vars = { name: 'Ada', place: 'Kvorum' };
    expect(render(template(), vars)).toEqual(render(template(), vars));
  });
});
