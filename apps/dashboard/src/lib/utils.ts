import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * Our `fontSize` scale is entirely custom (tailwind.config.js) and tailwind-merge only knows the
 * stock names. An unrecognised `text-*` falls into its text-COLOUR group, so `text-pill` collided
 * with `text-ink-2` in the same class string and the size was silently dropped — every primitive
 * pairing a size with a colour inside cn()/cva() (table head, input, select, segmented, tooltip, …)
 * rendered at the inherited 13px instead of its designed size. Registering the scale puts each class
 * in the right group, so a size and a colour no longer conflict.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        {
          text: [
            'micro',
            'caption',
            'pill',
            'mono-body',
            'small',
            'dense',
            'body',
            'body-lg',
            'lead',
            'h3',
            'h2',
            'h1',
            'hero',
          ],
        },
      ],
    },
  },
});

/** Merge class names, resolving Tailwind conflicts (last wins). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
