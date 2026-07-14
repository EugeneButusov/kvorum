// Worker-local mirror of libs/ai's canonical `*.md?raw` decl, so the barrel-pulled template
// loader typechecks under this app's tsconfig. Webpack inlines it via the asset/source rule below.
declare module '*.md?raw' {
  const content: string;
  export default content;
}
