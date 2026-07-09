'use client';

import { useState } from 'react';

import { Avatar, AvatarFallback, AvatarImage } from './avatar';
import { cn } from '@/lib/utils';

/** Shorten a 0x address to `0x1234…abcd`. */
export function truncateAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

export type IdentityChipProps = {
  address: string;
  /** ENS / platform handle, when known. Falls back to the truncated address. */
  name?: string;
  imageSrc?: string;
  copyable?: boolean;
  className?: string;
};

/**
 * Presentational identity chip: avatar + name/address + copy. The data-aware
 * enrichment (ENS→platform→address resolution, scorecard link) layers on top.
 */
export function IdentityChip({
  address,
  name,
  imageSrc,
  copyable = true,
  className,
}: IdentityChipProps) {
  const [copied, setCopied] = useState(false);
  const label = name ?? truncateAddress(address);
  const initials = (name ?? address.replace(/^0x/, '')).slice(0, 2).toUpperCase();

  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // clipboard unavailable — no-op
    }
  }

  return (
    <span className={cn('inline-flex items-center gap-2 font-mono text-mono-body', className)}>
      <Avatar>
        {imageSrc ? <AvatarImage src={imageSrc} alt="" /> : null}
        <AvatarFallback>{initials}</AvatarFallback>
      </Avatar>
      <span className="text-ink">{label}</span>
      {name != null && (
        <span className="text-caption text-ink-4" title={address}>
          {truncateAddress(address)}
        </span>
      )}
      {copyable && (
        <button
          type="button"
          onClick={copy}
          aria-label={copied ? 'Copied' : 'Copy address'}
          className="border border-line-3 px-[5px] text-micro text-ink-3 transition-colors hover:border-accent hover:text-accent"
        >
          {copied ? '✓' : '⧉'}
        </button>
      )}
    </span>
  );
}
