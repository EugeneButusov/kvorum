'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';

import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { CreatedKey } from '@/lib/developer/keys';

/**
 * One-time reveal of a newly created or rotated key (§6.13). The full secret is returned by the API
 * exactly once — only the hash is stored — so this is the sole moment the user can copy it. Closing
 * the dialog loses it for good.
 */
export function KeyRevealDialog({
  created,
  onClose,
}: {
  created: CreatedKey | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.key);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable — the key is still selectable in the field
    }
  }

  return (
    <Dialog
      open={created !== null}
      onOpenChange={(open) => {
        if (!open) {
          setCopied(false);
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Copy your API key</DialogTitle>
          <DialogDescription>
            This is the only time the full key is shown. Store it somewhere safe.
          </DialogDescription>
        </DialogHeader>

        <Banner severity="warn" glyph="!">
          Kvorum never stores the full key — if you lose it you’ll need to rotate.
        </Banner>

        <div className="flex items-stretch gap-2">
          <code className="min-w-0 flex-1 select-all overflow-x-auto whitespace-nowrap border border-line-2 bg-bg px-3 py-2 font-mono text-small text-ink">
            {created?.key}
          </code>
          <Button variant="outline" onClick={copy} aria-label="Copy API key" className="shrink-0">
            {copied ? <Check /> : <Copy />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>

        <DialogFooter>
          <Button
            onClick={() => {
              setCopied(false);
              onClose();
            }}
          >
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
