import { PromptTemplateError, type PromptFrontmatter } from './types.js';

const REQUIRED_KEYS = ['name', 'version', 'model', 'schema', 'description'] as const;
type RequiredKey = (typeof REQUIRED_KEYS)[number];

export interface ParsedTemplate {
  frontmatter: PromptFrontmatter;
  body: string;
}

function requireKey(parsed: Map<string, string>, key: RequiredKey): string {
  const value = parsed.get(key);
  if (value === undefined) {
    throw new PromptTemplateError(`frontmatter missing required key: "${key}"`);
  }
  return value;
}

// Finds the index of the `\n` that starts the closing "---" fence line, i.e. a line
// containing exactly "---" with nothing else. A candidate match is only valid when the
// character right after "---" is either a newline or end-of-string — this rejects
// look-alikes such as "----" or "---foo" that merely start with "---".
function findClosingFenceIndex(normalized: string, fromIndex: number): number {
  let searchFrom = fromIndex;
  for (;;) {
    const candidate = normalized.indexOf('\n---', searchFrom);
    if (candidate === -1) {
      return -1;
    }
    const afterFenceIdx = candidate + 4;
    const charAfterFence =
      afterFenceIdx < normalized.length ? normalized[afterFenceIdx] : undefined;
    if (charAfterFence === undefined || charAfterFence === '\n') {
      return candidate;
    }
    searchFrom = candidate + 4;
  }
}

export function parseFrontmatter(raw: string): ParsedTemplate {
  const normalized = raw.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) {
    throw new PromptTemplateError('template must start with a "---" frontmatter fence');
  }
  const closeIdx = findClosingFenceIndex(normalized, 4);
  if (closeIdx === -1) {
    throw new PromptTemplateError('template frontmatter is missing its closing "---" fence');
  }
  const block = normalized.slice(4, closeIdx);
  const body = normalized.slice(closeIdx + 4).replace(/^\n/, '');

  const parsed = new Map<string, string>();
  const allowed = new Set<string>(REQUIRED_KEYS);
  for (const line of block.split('\n')) {
    if (line.trim() === '') continue;
    const sep = line.indexOf(': ');
    if (sep === -1) {
      throw new PromptTemplateError(`invalid frontmatter line (expected "key: value"): "${line}"`);
    }
    const key = line.slice(0, sep).trim();
    const value = line.slice(sep + 2).trim();
    if (!allowed.has(key)) {
      throw new PromptTemplateError(`unknown frontmatter key: "${key}"`);
    }
    if (parsed.has(key)) {
      throw new PromptTemplateError(`duplicate frontmatter key: "${key}"`);
    }
    parsed.set(key, value);
  }

  return {
    frontmatter: {
      name: requireKey(parsed, 'name'),
      version: requireKey(parsed, 'version'),
      model: requireKey(parsed, 'model'),
      schema: requireKey(parsed, 'schema'),
      description: requireKey(parsed, 'description'),
    },
    body,
  };
}
