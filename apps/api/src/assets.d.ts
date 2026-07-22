// apps/api transitively imports @libs/ai (the ai_summary read path), whose prompt-template loader
// uses `*.md?raw` imports. Mirror libs/ai's ambient decl so this app's tsconfig typechecks; the
// webpack `asset/source` rule (resourceQuery /raw/) inlines the content at build time.
declare module '*.md?raw' {
  const content: string;
  export default content;
}
