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
import { Section } from '@/components/ui/section';
import { useLogoutEverywhere } from '@/lib/auth/use-session';
import { useDeleteAccount } from '@/lib/developer/use-keys';

/**
 * Account controls (§6.13): sign out everywhere (destroys every session for the user) and permanent
 * account deletion. Deletion is gated behind a typed confirmation because it's irreversible — it
 * revokes all keys, removes the account, and ends every session.
 */
export function AccountSection() {
  const logoutAll = useLogoutEverywhere();
  const deleteAccount = useDeleteAccount();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');

  return (
    <Section number="5" title="Account">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <span className="text-body font-medium text-ink">Sign out everywhere</span>
          <span className="text-small text-ink-3">
            Ends every active session for your account across all devices.
          </span>
        </div>
        <Button
          variant="outline"
          disabled={logoutAll.isPending}
          onClick={() => logoutAll.mutate()}
          className="shrink-0"
        >
          {logoutAll.isPending && <Loader2 className="animate-spin" />}
          Sign out everywhere
        </Button>
      </div>

      <div className="flex flex-col gap-4 border-t border-line-3 pt-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <span className="text-body font-medium text-ink">Delete account</span>
          <span className="text-small text-ink-3">
            Permanently deletes your account and revokes every API key. This can’t be undone.
          </span>
        </div>
        <Button variant="destructive" onClick={() => setConfirmOpen(true)} className="shrink-0">
          Delete account
        </Button>
      </div>

      <Dialog
        open={confirmOpen}
        onOpenChange={(open) => {
          setConfirmOpen(open);
          if (!open) setConfirmText('');
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete your account?</DialogTitle>
            <DialogDescription>
              This is permanent. Your API keys stop working immediately and the account is removed.
              Type <span className="font-mono text-ink">DELETE</span> to confirm.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="DELETE"
            aria-label="Type DELETE to confirm"
          />
          {deleteAccount.isError && (
            <Banner severity="warn" glyph="×">
              Could not delete the account. Try again.
            </Banner>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={confirmText !== 'DELETE' || deleteAccount.isPending}
              onClick={() => deleteAccount.mutate()}
            >
              {deleteAccount.isPending && <Loader2 className="animate-spin" />}
              Delete account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Section>
  );
}
