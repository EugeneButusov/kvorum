// `@joplin/turndown-plugin-gfm` ships no type declarations. Import it untyped here and re-export the
// single plugin we use with a proper signature, so consumers (and transitive typecheckers that pull
// this file in via the path alias) need no ambient module declaration. A turndown plugin is a
// function that registers rules on the service instance.
// @ts-expect-error -- no declaration file for '@joplin/turndown-plugin-gfm'
import { tables as tablesPlugin } from '@joplin/turndown-plugin-gfm';
import type TurndownService from 'turndown';

export const tables = tablesPlugin as (service: TurndownService) => void;
