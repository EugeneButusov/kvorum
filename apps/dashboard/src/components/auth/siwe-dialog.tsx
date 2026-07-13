'use client';

import { Loader2 } from 'lucide-react';

import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { SIWE_STATEMENT } from '@/lib/auth/siwe';
import { useSiweFlow } from '@/lib/auth/use-siwe-flow';
import { AUTH_CHAIN } from '@/lib/wallet/config';

export type SiweDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Signup path passes a recovery email captured before the wallet handshake. */
  email?: string;
  /** Fired once the session is established (redirect-to-original / close the nav dialog). */
  onSuccess?: () => void;
  title?: string;
  description?: string;
};

export function SiweDialog({
  open,
  onOpenChange,
  email,
  onSuccess,
  title = 'Connect wallet',
  description = 'Sign in with Ethereum to manage your API keys.',
}: SiweDialogProps) {
  const flow = useSiweFlow({
    email,
    onSuccess: () => {
      onSuccess?.();
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 pt-2">
          {flow.step === 'disconnected' && (
            <Button onClick={flow.start} className="w-full">
              Connect wallet
            </Button>
          )}

          {flow.step === 'connecting' && (
            <Button disabled className="w-full">
              <Loader2 className="animate-spin" />
              Connecting…
            </Button>
          )}

          {flow.step === 'wrong-chain' && (
            <div className="flex flex-col gap-3">
              <Banner severity="note" glyph="!">
                Your wallet is on the wrong network. Kvorum signs in on {AUTH_CHAIN.name}.
              </Banner>
              <Button
                onClick={flow.switchToAuthChain}
                disabled={flow.isSwitching}
                className="w-full"
              >
                {flow.isSwitching && <Loader2 className="animate-spin" />}
                Switch to {AUTH_CHAIN.name}
              </Button>
            </div>
          )}

          {flow.step === 'signing' && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3 text-body text-ink-2">
                <Loader2 className="size-4 animate-spin text-primary" />
                Check your wallet — sign to continue.
              </div>
              <p className="border border-line-3 bg-bg p-3 font-mono text-small text-ink-3">
                {SIWE_STATEMENT}
              </p>
              <Button variant="outline" onClick={() => onOpenChange(false)} className="w-full">
                Cancel
              </Button>
            </div>
          )}

          {flow.step === 'error' && (
            <div className="flex flex-col gap-3">
              <Banner severity="warn" glyph="×">
                {flow.error ?? 'Sign-in failed.'}
              </Banner>
              <Button onClick={flow.retry} className="w-full">
                Try again
              </Button>
            </div>
          )}

          {flow.step === 'success' && (
            <Banner severity="ok" glyph="✓">
              Signed in.
            </Banner>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
