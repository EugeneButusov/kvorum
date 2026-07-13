'use client';

import { Loader2, Plus } from 'lucide-react';
import { useState } from 'react';

import { CreateKeyDialog } from './create-key-dialog';
import { KeyRevealDialog } from './key-reveal-dialog';
import { KeyStatusBadge } from './key-status-badge';
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
import { Section } from '@/components/ui/section';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { ApiKey, CreatedKey } from '@/lib/developer/keys';
import { useKeys, useRevokeKey, useRotateKey } from '@/lib/developer/use-keys';
import { formatDate } from '@/lib/format';

export function ApiKeysSection() {
  const keys = useKeys();
  const rotate = useRotateKey();
  const revoke = useRevokeKey();
  const [createOpen, setCreateOpen] = useState(false);
  const [revealed, setRevealed] = useState<CreatedKey | null>(null);
  const [revoking, setRevoking] = useState<ApiKey | null>(null);

  function onRotate(key: ApiKey) {
    rotate.mutate(key.id, { onSuccess: (created) => setRevealed(created) });
  }

  function confirmRevoke() {
    if (!revoking) return;
    revoke.mutate(revoking.id, { onSuccess: () => setRevoking(null) });
  }

  return (
    <Section
      number="1"
      title="API keys"
      reference={
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus />
          New key
        </Button>
      }
    >
      {keys.isLoading ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : keys.isError ? (
        <Banner severity="warn" glyph="×">
          Could not load your API keys. Refresh to try again.
        </Banner>
      ) : keys.data && keys.data.length > 0 ? (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Key</TableHead>
                <TableHead>Label</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Last used</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.data.map((key) => {
                const revocable = key.status !== 'revoked';
                return (
                  <TableRow key={key.id}>
                    <TableCell className="font-mono text-small text-ink">
                      {key.prefix}…{key.last_four}
                    </TableCell>
                    <TableCell className="text-small text-ink-2">{key.label ?? '—'}</TableCell>
                    <TableCell className="text-small text-ink-3">
                      {formatDate(key.created_at)}
                    </TableCell>
                    <TableCell className="text-small text-ink-3">
                      {key.last_used_at ? formatDate(key.last_used_at) : 'Never'}
                    </TableCell>
                    <TableCell>
                      <KeyStatusBadge status={key.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      {revocable && (
                        <div className="inline-flex gap-1.5">
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={rotate.isPending}
                            onClick={() => onRotate(key)}
                          >
                            {rotate.isPending && rotate.variables === key.id && (
                              <Loader2 className="animate-spin" />
                            )}
                            Rotate
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setRevoking(key)}>
                            Revoke
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="border border-dashed border-line-2 px-4 py-8 text-center text-small text-ink-3">
          No API keys yet. Create one to start calling the Kvorum API.
        </div>
      )}

      <CreateKeyDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(created) => setRevealed(created)}
      />
      <KeyRevealDialog created={revealed} onClose={() => setRevealed(null)} />

      <Dialog open={revoking !== null} onOpenChange={(open) => !open && setRevoking(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Revoke this key?</DialogTitle>
            <DialogDescription>
              {revoking ? `${revoking.prefix}…${revoking.last_four}` : ''} stops working
              immediately. This can’t be undone.
            </DialogDescription>
          </DialogHeader>
          {revoke.isError && (
            <Banner severity="warn" glyph="×">
              Could not revoke the key. Try again.
            </Banner>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevoking(null)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={revoke.isPending} onClick={confirmRevoke}>
              {revoke.isPending && <Loader2 className="animate-spin" />}
              Revoke key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Section>
  );
}
