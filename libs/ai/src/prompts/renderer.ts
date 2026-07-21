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

// `inputContent` becomes the LLMClient input_hash, one component of the #432 cache key
// (feature, prompt_version, input_hash). `vars` MUST contain only the substantive content of
// the request — never volatile fields (timestamps, request IDs, locale), or every call will
// cache-miss despite identical content. See the design's cache-key contract.
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
    // Feature is decoupled from the template name (#437): variants (e.g. binding vs signaling
    // summarizer) declare a shared `feature` while keeping distinct names. Absent → feature = name.
    feature: template.feature ?? template.name,
    promptVersion: template.version,
    model: template.model,
    schema: template.schema,
    messages: [{ role: 'user', content }],
    inputContent: canonicalInputContent(vars),
  };
}
