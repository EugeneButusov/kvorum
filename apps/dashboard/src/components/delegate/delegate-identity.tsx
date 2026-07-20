'use client';

import Link from 'next/link';
import { useState } from 'react';

import type { DelegateProfile } from '@/lib/analytics/delegate';
import { truncateAddress } from '@/lib/format';

/**
 * Identity header, ported from the reference's `.head`: a three-column grid of avatar, identity
 * block, and actions.
 *
 * Two deliberate departures from the reference, both because the underlying facts do not exist
 * rather than for design reasons (ADR-086):
 *
 * - No verified badge, external links or Karma score — none of that is modelled.
 * - No "★ Watch" / "Delegate to →" buttons. Rendering dead controls would promise interactions the
 *   product does not have; the slot instead holds the two navigations that are real, including the
 *   link to the cross-DAO actor page that SPEC §6.11 §1 asks for and the page was missing.
 */
export function DelegateIdentity({ slug, profile }: { slug: string; profile: DelegateProfile }) {
  return (
    <header className="grid grid-cols-[auto_1fr] items-center gap-5 border-b border-line pb-6 sm:gap-7 lg:grid-cols-[auto_1fr_auto]">
      <Avatar address={profile.address} />

      <div className="min-w-0">
        <h1 className="flex items-baseline gap-3 font-mono text-h2 font-semibold tracking-tight text-ink">
          {profile.name ?? truncateAddress(profile.address)}
        </h1>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3.5 gap-y-1 font-mono text-body text-ink-2">
          <code className="break-all">{profile.address}</code>
          <CopyAddress address={profile.address} />
        </div>
        <div className="mt-2.5 flex flex-wrap gap-4 font-mono text-small text-ink-3">
          <Link
            href={`/actors/${profile.address}`}
            className="border-b border-line-2 text-ink-2 transition-colors hover:border-primary hover:text-primary"
          >
            Cross-DAO activity ↗
          </Link>
        </div>
      </div>

      <div className="col-span-2 flex gap-2 lg:col-span-1 lg:flex-col">
        <Link
          href={`/daos/${slug}/delegates`}
          className="border border-line-2 bg-bg-2 px-3.5 py-2 font-mono text-small text-ink transition-colors hover:border-line hover:text-primary"
        >
          All delegates →
        </Link>
      </div>
    </header>
  );
}

/**
 * A deterministic identicon derived from the address itself — the reference's `.avatar` slot. It
 * encodes real bytes rather than standing in for a profile picture we do not have, so two addresses
 * are always distinguishable and the same address always looks the same.
 */
function Avatar({ address }: { address: string }) {
  const seed = address.replace(/^0x/, '');
  const cells = Array.from(
    { length: 25 },
    (_, i) => parseInt(seed[i % seed.length] ?? '0', 16) % 3,
  );

  return (
    <div
      aria-hidden
      className="grid h-16 w-16 grid-cols-5 overflow-hidden rounded-full border-[1.5px] border-ink sm:h-24 sm:w-24"
    >
      {cells.map((weight, i) => (
        <span key={i} className={weight === 0 ? 'bg-bg-2' : weight === 1 ? 'bg-ink-4' : 'bg-ink'} />
      ))}
    </div>
  );
}

function CopyAddress({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(address).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="shrink-0 border-b border-dashed border-line-2 font-mono text-small text-ink-3 transition-colors hover:text-ink"
    >
      {copied ? '✓ copied' : '⎘ copy'}
    </button>
  );
}
