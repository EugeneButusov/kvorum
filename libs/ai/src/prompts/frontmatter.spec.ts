import { describe, expect, it } from 'vitest';
import { parseFrontmatter } from './frontmatter.js';
import { PromptTemplateError } from './types.js';

const VALID = `---
name: fixture_greeting
version: v1.0
model: claude-haiku-4-5
schema: FixtureSchema
description: Produces a greeting: with a colon in the description.
---
Hello {{name}}, welcome to {{place}}.
`;

describe('parseFrontmatter', () => {
  it('parses the 5 keys and returns the body', () => {
    const { frontmatter, body } = parseFrontmatter(VALID);
    expect(frontmatter).toEqual({
      name: 'fixture_greeting',
      version: 'v1.0',
      model: 'claude-haiku-4-5',
      schema: 'FixtureSchema',
      description: 'Produces a greeting: with a colon in the description.',
    });
    expect(body).toBe('Hello {{name}}, welcome to {{place}}.\n');
  });

  it('splits on the first ": " so descriptions may contain colons', () => {
    expect(parseFrontmatter(VALID).frontmatter.description).toContain(': ');
  });

  it('throws when a required key is missing', () => {
    const raw = VALID.replace('model: claude-haiku-4-5\n', '');
    expect(() => parseFrontmatter(raw)).toThrow(/missing required key: "model"/);
  });

  it('throws on an unknown key', () => {
    const raw = VALID.replace('description:', 'extra: nope\ndescription:');
    expect(() => parseFrontmatter(raw)).toThrow(/unknown frontmatter key: "extra"/);
  });

  it('parses the optional "feature" key when present', () => {
    const raw = VALID.replace(
      'name: fixture_greeting\n',
      'name: fixture_greeting\nfeature: proposal_summarizer\n',
    );
    expect(parseFrontmatter(raw).frontmatter.feature).toBe('proposal_summarizer');
  });

  it('throws on a duplicate key', () => {
    const raw = VALID.replace('version: v1.0\n', 'version: v1.0\nversion: v9\n');
    expect(() => parseFrontmatter(raw)).toThrow(/duplicate frontmatter key: "version"/);
  });

  it('throws when the closing fence is missing', () => {
    const raw = '---\nname: x\n';
    expect(() => parseFrontmatter(raw)).toThrow(PromptTemplateError);
  });

  it('throws when there is no opening fence', () => {
    expect(() => parseFrontmatter('no fence here')).toThrow(/must start with/);
  });

  it('rejects a non-fence line like "----" as the closing fence', () => {
    const raw = '---\nname: x\nversion: v1.0\nmodel: m\nschema: s\ndescription: d\n----\n';
    expect(() => parseFrontmatter(raw)).toThrow(/missing its closing "---" fence/);
  });

  it('parses correctly with a normal "\\n---\\n" close', () => {
    const { body } = parseFrontmatter(VALID);
    expect(body).toBe('Hello {{name}}, welcome to {{place}}.\n');
  });

  it('parses correctly with a "---" close at end-of-file (no trailing body)', () => {
    const raw = '---\nname: x\nversion: v1.0\nmodel: m\nschema: s\ndescription: d\n---';
    const { frontmatter, body } = parseFrontmatter(raw);
    expect(frontmatter).toEqual({
      name: 'x',
      version: 'v1.0',
      model: 'm',
      schema: 's',
      description: 'd',
    });
    expect(body).toBe('');
  });

  it('throws on an invalid frontmatter line with no ": " separator', () => {
    const raw = VALID.replace('description:', 'garbage\ndescription:');
    expect(() => parseFrontmatter(raw)).toThrow(/invalid frontmatter line/);
  });
});
