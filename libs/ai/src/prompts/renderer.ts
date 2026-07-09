import { PromptRenderError, type PromptTemplate, type RenderedPrompt } from './types.js';

const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

function interpolate(body: string, vars: Record<string, string>): string {
  const missing = new Set<string>();
  const out = body.replace(PLACEHOLDER, (_match: string, key: string) => {
    const value = vars[key];
    if (value === undefined) {
      missing.add(key);
      return '';
    }
    return value;
  });
  if (missing.size > 0) {
    throw new PromptRenderError([...missing].sort());
  }
  return out;
}

function canonicalInputContent(vars: Record<string, string>): string {
  const sorted: Record<string, string> = {};
  for (const key of Object.keys(vars).sort()) {
    const value = vars[key];
    if (value !== undefined) {
      sorted[key] = value;
    }
  }
  return JSON.stringify(sorted);
}

export function render<T>(
  template: PromptTemplate<T>,
  vars: Record<string, string>,
): RenderedPrompt<T> {
  const content = interpolate(template.body, vars);
  return {
    feature: template.name,
    promptVersion: template.version,
    model: template.model,
    schema: template.schema,
    messages: [{ role: 'user', content }],
    inputContent: canonicalInputContent(vars),
  };
}
