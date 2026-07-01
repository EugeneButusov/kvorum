// `@joplin/turndown-plugin-gfm` ships no type declarations. A turndown plugin is a function that
// receives the TurndownService instance and registers rules on it.
declare module '@joplin/turndown-plugin-gfm' {
  import type TurndownService from 'turndown';
  type Plugin = (service: TurndownService) => void;
  export const gfm: Plugin;
  export const tables: Plugin;
  export const strikethrough: Plugin;
  export const taskListItems: Plugin;
  export const highlightedCodeBlock: Plugin;
}
