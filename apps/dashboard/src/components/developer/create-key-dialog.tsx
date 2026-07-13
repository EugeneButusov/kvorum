'use client';

import { Loader2 } from 'lucide-react';
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
import { Input } from '@/components/ui/input';
import type { CreatedKey } from '@/lib/developer/keys';
import { useCreateKey } from '@/lib/developer/use-keys';

/** Create-key form (§6.13). On success it hands the one-time secret up so the reveal dialog opens. */
export function CreateKeyDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (created: CreatedKey) => void;
}) {
  const [label, setLabel] = useState('');
  const create = useCreateKey();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    create.mutate(label, {
      onSuccess: (created) => {
        setLabel('');
        create.reset();
        onOpenChange(false);
        onCreated(created);
      },
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setLabel('');
          create.reset();
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-md">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>New API key</DialogTitle>
            <DialogDescription>
              Give the key a label so you can tell it apart later. Optional.
            </DialogDescription>
          </DialogHeader>

          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-caption uppercase tracking-[0.06em] text-ink-3">
              Label
            </span>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. production backend"
              maxLength={64}
              autoFocus
            />
          </label>

          {create.isError && (
            <Banner severity="warn" glyph="×">
              {create.error instanceof Error ? create.error.message : 'Could not create the key.'}
            </Banner>
          )}

          <DialogFooter>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending && <Loader2 className="animate-spin" />}
              Create key
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
