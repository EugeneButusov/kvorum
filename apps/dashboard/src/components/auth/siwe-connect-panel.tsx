'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { SiweDialog } from './siwe-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useSession } from '@/lib/auth/use-session';

type Mode = 'login' | 'signup';

const COPY: Record<
  Mode,
  { heading: string; cta: string; alt: { prompt: string; href: string; label: string } }
> = {
  login: {
    heading: 'Sign in to Kvorum',
    cta: 'Connect wallet',
    alt: { prompt: 'Need an account?', href: '/signup', label: 'Sign up' },
  },
  signup: {
    heading: 'Create your Kvorum account',
    cta: 'Connect wallet to sign up',
    alt: { prompt: 'Already have an account?', href: '/login', label: 'Sign in' },
  },
};

/**
 * The SIWE-first auth panel shared by /login and /signup (§6.14). Wallet is the primary path; the
 * email path is a documented fast-follow and renders as a disabled affordance. On an established
 * session it redirects to `next` (already open-redirect-sanitised by the server page).
 */
export function SiweConnectPanel({ mode, next }: { mode: Mode; next: string }) {
  const router = useRouter();
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const copy = COPY[mode];

  // Already signed in (or just became so) → leave the gateway for the intended destination.
  useEffect(() => {
    if (session) router.replace(next);
  }, [session, next, router]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h1 className="font-mono text-lead font-semibold text-ink">{copy.heading}</h1>
        <p className="text-small text-ink-3">
          Sign in with your Ethereum wallet to manage API keys. No password, no gas.
        </p>
      </div>

      {mode === 'signup' && (
        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-caption uppercase tracking-[0.06em] text-ink-3">
            Recovery email (optional)
          </span>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
          />
          <span className="text-caption text-ink-4">
            For recovery and notifications. You can add or change it later.
          </span>
        </label>
      )}

      <Button onClick={() => setOpen(true)} className="w-full">
        {copy.cta}
      </Button>

      <div className="flex items-center gap-3 text-caption text-ink-4">
        <span className="h-px flex-1 bg-line-3" />
        or
        <span className="h-px flex-1 bg-line-3" />
      </div>

      <div className="flex flex-col gap-1.5">
        <Button variant="outline" disabled className="w-full">
          Continue with email
        </Button>
        <span className="text-center text-caption text-ink-4">Email accounts coming soon.</span>
      </div>

      <p className="text-center text-small text-ink-3">
        {copy.alt.prompt}{' '}
        <Link href={copy.alt.href} className="text-primary hover:underline">
          {copy.alt.label}
        </Link>
      </p>

      <SiweDialog
        open={open}
        onOpenChange={setOpen}
        email={mode === 'signup' && email.trim() !== '' ? email.trim() : undefined}
        onSuccess={() => router.replace(next)}
        title={copy.cta}
        description="Sign the message in your wallet to continue."
      />
    </div>
  );
}
