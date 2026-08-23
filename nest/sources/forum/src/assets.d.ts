// @nest/forum's read API imports @libs/ai (the forum-synthesis reader), whose prompt-template loader
// uses `*.md?raw` imports. Mirror libs/ai's ambient decl so this package's tsconfig typechecks; the
// consuming app's webpack `asset/source` rule (resourceQuery /raw/) inlines the content at build time.
declare module '*.md?raw' {
  const content: string;
  export default content;
}
