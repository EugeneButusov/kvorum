import React from 'react';
import styles from './Logo.module.css';

/**
 * Kvorum — brand mark.
 *
 * Concept: a quorum-threshold bar. The filled portion is "votes recorded",
 * the vertical accent line is the quorum threshold, the K is carved from
 * the filled portion in negative space.
 *
 * Color contract:
 *   - `currentColor` drives the bar fill + outline → set via CSS `color:`
 *   - `--kv-accent` controls the threshold marker (default: design-system --accent)
 *   - `--kv-surface` controls the carved-K negative space — MUST match the
 *     surface the logo sits on (default: --bg-2). Set this on the parent
 *     when placing the logo on a non-default background.
 *
 * Sizes: `size` sets the rendered px (square). The lockup adds the wordmark.
 */

type LogoProps = {
  size?: number;
  variant?: 'glyph' | 'lockup' | 'wordmark';
  className?: string;
  title?: string;
};

export function Logo({ size = 28, variant = 'glyph', className, title = 'Kvorum' }: LogoProps) {
  if (variant === 'wordmark') {
    return (
      <span className={[styles.wordmark, className].filter(Boolean).join(' ')} aria-label={title}>
        KVORUM
      </span>
    );
  }

  const glyph = (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      role="img"
      aria-label={title}
      className={styles.glyph}
    >
      {/* Background track */}
      <rect x="4" y="22" width="56" height="20" fill="none" stroke="currentColor" strokeWidth="2" />
      {/* Filled portion (quorum reached) */}
      <rect x="4" y="22" width="38" height="20" fill="currentColor" />
      {/* Threshold marker */}
      <rect x="40" y="10" width="3" height="44" className={styles.accent} />
      {/* K — carved from filled portion */}
      <rect x="15" y="26" width="3" height="12" className={styles.surface} />
      <polygon points="18,32 25,26 28,26 21,32 28,38 25,38" className={styles.surface} />
    </svg>
  );

  if (variant === 'glyph') return glyph;

  // lockup
  return (
    <span className={[styles.lockup, className].filter(Boolean).join(' ')} aria-label={title}>
      {glyph}
      <span className={styles.wordmark} aria-hidden="true">KVORUM</span>
    </span>
  );
}

export default Logo;
