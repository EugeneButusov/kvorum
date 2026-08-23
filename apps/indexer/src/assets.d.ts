// apps/indexer transitively pulls @libs/ai through @nest/sources → @nest/forum (whose read API now
// serves forum synthesis), and @libs/ai's prompt-template loader uses `*.md?raw` imports. Mirror
// libs/ai's ambient decl so this app's tsconfig typechecks; the webpack `asset/source` rule
// (resourceQuery /raw/) inlines the content at build time. The indexer never runs the AI read path,
// so this is type-resolution only.
declare module '*.md?raw' {
  const content: string;
  export default content;
}
