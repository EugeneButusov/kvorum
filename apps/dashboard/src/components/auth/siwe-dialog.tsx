'use client';

import { Loader2 } from 'lucide-react';
import { useEffect, useRef } from 'react';

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

  // Opening this dialog *is* the request to connect — the button that opened it already said so,
  // and a second "Connect wallet" inside was a click that carried no decision. So go straight to
  // the wallet; the dialog becomes the progress surface behind the extension's own prompt.
  //
  // Latched per opening rather than driven off `step`: a cancelled prompt returns the flow to
  // `disconnected`, which would otherwise re-open the wallet immediately and trap the user in a
  // loop they cannot dismiss.
  const started = useRef(false);
  const { step, start, retry } = flow;
  useEffect(() => {
    if (!open) {
      started.current = false;
      return;
    }
    if (started.current) {
      return;
    }
    if (step === 'disconnected') {
      started.current = true;
      start();
    } else if (step === 'error') {
      // This dialog stays mounted while closed, so the flow's state outlives a dismissal: without
      // this, reopening after a cancelled attempt would show a stale "Try again" rather than
      // simply asking the wallet again, which is what reopening means.
      started.current = true;
      retry();
    }
  }, [open, step, start, retry]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 pt-2">
          {/* Both are the same moment to the reader: the wallet is being opened. `disconnected`
              is the tick before wagmi reports pending, not a state needing its own control. */}
          {(flow.step === 'disconnected' || flow.step === 'connecting') && (
            <div className="flex items-center gap-3 text-body text-ink-2">
              <Loader2 className="size-4 animate-spin text-primary" />
              Check your wallet — approve the connection.
            </div>
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
