// Raw string imports of Markdown templates. Inlined by Vite (vitest) natively and by
// consuming apps' webpack `asset/source` rule (see design §2). The lib owns this canonical decl.
declare module '*.md?raw' {
  const content: string;
  export default content;
}
