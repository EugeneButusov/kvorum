import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type Operation = { summary?: string; description?: string; tags?: string[] };
type Document = {
  tags?: { name: string; description?: string }[];
  paths: Record<string, Record<string, Operation>>;
};

const DOC_PATH = resolve(__dirname, '../../../../docs/openapi.json');
const doc = JSON.parse(readFileSync(DOC_PATH, 'utf8')) as Document;

const METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options']);

const operations = Object.entries(doc.paths).flatMap(([path, byMethod]) =>
  Object.entries(byMethod)
    .filter(([method]) => METHODS.has(method))
    .map(([method, operation]) => ({ id: `${method.toUpperCase()} ${path}`, operation })),
);

describe('published OpenAPI document', () => {
  it('documents every operation', () => {
    // The docs page renders `summary` as the label on a collapsed operation. Without one, Swagger
    // shows a bare path and marks the row `.no-desc` — which is how all 28 endpoints looked before
    // this contract existed. Keep it, or the reference silently decays back into a list of URLs.
    const undocumented = operations
      .filter(({ operation }) => (operation.summary ?? '').trim() === '')
      .map(({ id }) => id);

    expect(undocumented).toEqual([]);
    expect(operations.length).toBeGreaterThan(0);
  });

  it('gives every operation a description distinct from its summary', () => {
    const thin = operations
      .filter(({ operation }) => {
        const description = (operation.description ?? '').trim();
        return description === '' || description === (operation.summary ?? '').trim();
      })
      .map(({ id }) => id);

    expect(thin).toEqual([]);
  });

  it('files every operation under a declared tag', () => {
    const declared = new Set((doc.tags ?? []).map((tag) => tag.name));
    expect(declared.size).toBeGreaterThan(0);

    const orphaned = operations
      .filter(({ operation }) => (operation.tags ?? []).some((tag) => !declared.has(tag)))
      .map(({ id }) => id);

    expect(orphaned).toEqual([]);
  });

  it('describes every declared tag', () => {
    const undescribed = (doc.tags ?? [])
      .filter((tag) => (tag.description ?? '').trim() === '')
      .map((tag) => tag.name);

    expect(undescribed).toEqual([]);
  });

  it('names tags consistently', () => {
    // They were split between `App`/`Health` and lowercase `actors`/`daos`/`proposals`, which
    // Swagger renders as-is — two casing conventions in one sidebar.
    const misnamed = (doc.tags ?? [])
      .map((tag) => tag.name)
      .filter((name) => name !== name.charAt(0).toUpperCase() + name.slice(1));

    expect(misnamed).toEqual([]);
  });
});
