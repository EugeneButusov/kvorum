import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import fixtureV10 from './__fixtures__/fixture_v1_0.md?raw';
import fixtureV11 from './__fixtures__/fixture_v1_1.md?raw';
import { defineTemplates, getTemplate } from './registry.js';
import { render } from './renderer.js';
import { PromptTemplateError } from './types.js';

const FixtureSchema = z.object({ answer: z.string() });

describe('defineTemplates + getTemplate', () => {
  it('inlines the .md?raw fixture and registers it by name', () => {
    expect(typeof fixtureV10).toBe('string');
    expect(fixtureV10).toContain('name: fixture_greeting');

    const reg = defineTemplates([
      { raw: fixtureV10, schema: FixtureSchema, schemaName: 'FixtureSchema' },
    ]);
    const t = getTemplate(reg, 'fixture_greeting');
    expect(t.version).toBe('v1.0');
    expect(t.schema).toBe(FixtureSchema);
  });

  it('throws on an unknown template name', () => {
    const reg = defineTemplates([
      { raw: fixtureV10, schema: FixtureSchema, schemaName: 'FixtureSchema' },
    ]);
    expect(() => getTemplate(reg, 'nope')).toThrow(/unknown prompt template: "nope"/);
  });

  it('throws when the frontmatter schema label mismatches the registered schemaName', () => {
    expect(() =>
      defineTemplates([{ raw: fixtureV10, schema: FixtureSchema, schemaName: 'WrongName' }]),
    ).toThrow(PromptTemplateError);
  });

  it('throws on a duplicate template name in one registry', () => {
    expect(() =>
      defineTemplates([
        { raw: fixtureV10, schema: FixtureSchema, schemaName: 'FixtureSchema' },
        { raw: fixtureV11, schema: FixtureSchema, schemaName: 'FixtureSchema' },
      ]),
    ).toThrow(/duplicate template name: "fixture_greeting"/);
  });

  it('renders end-to-end through the registry', () => {
    const reg = defineTemplates([
      { raw: fixtureV10, schema: FixtureSchema, schemaName: 'FixtureSchema' },
    ]);
    const r = render(getTemplate(reg, 'fixture_greeting'), { name: 'Ada', place: 'Kvorum' });
    expect(r.messages[0]?.content).toBe('Hello Ada, welcome to Kvorum.');
    expect(r.feature).toBe('fixture_greeting');
  });

  it('version pinning: bumping the template version changes only new stamps', () => {
    const regV10 = defineTemplates([
      { raw: fixtureV10, schema: FixtureSchema, schemaName: 'FixtureSchema' },
    ]);
    const regV11 = defineTemplates([
      { raw: fixtureV11, schema: FixtureSchema, schemaName: 'FixtureSchema' },
    ]);
    const vars = { name: 'Ada', place: 'Kvorum' };
    expect(render(getTemplate(regV10, 'fixture_greeting'), vars).promptVersion).toBe('v1.0');
    expect(render(getTemplate(regV11, 'fixture_greeting'), vars).promptVersion).toBe('v1.1');
  });
});
