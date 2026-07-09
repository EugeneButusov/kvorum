import { parseFrontmatter } from './frontmatter.js';
import { PromptTemplateError, type PromptTemplate, type TemplateDef } from './types.js';

export type TemplateRegistry = ReadonlyMap<string, PromptTemplate>;

export function defineTemplates(defs: TemplateDef[]): TemplateRegistry {
  const registry = new Map<string, PromptTemplate>();
  for (const def of defs) {
    const { frontmatter, body } = parseFrontmatter(def.raw);
    if (frontmatter.schema !== def.schemaName) {
      throw new PromptTemplateError(
        `template "${frontmatter.name}" declares schema "${frontmatter.schema}" ` +
          `but was registered with schemaName "${def.schemaName}"`,
      );
    }
    if (registry.has(frontmatter.name)) {
      throw new PromptTemplateError(`duplicate template name: "${frontmatter.name}"`);
    }
    registry.set(frontmatter.name, {
      name: frontmatter.name,
      version: frontmatter.version,
      model: frontmatter.model,
      schema: def.schema,
      description: frontmatter.description,
      body,
    });
  }
  return registry;
}

export function getTemplate(registry: TemplateRegistry, name: string): PromptTemplate {
  const template = registry.get(name);
  if (template === undefined) {
    throw new PromptTemplateError(`unknown prompt template: "${name}"`);
  }
  return template;
}
