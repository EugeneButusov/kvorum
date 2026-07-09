import styles from './Logo.module.css';

/**
 * Kvorum brand mark — a quorum-threshold bar. The filled portion is "votes recorded",
 * the vertical accent line is the quorum threshold, the K is carved in negative space.
 * `currentColor` drives the bar; --kv-accent the threshold; --kv-surface the carved K.
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
      <rect x="4" y="22" width="56" height="20" fill="none" stroke="currentColor" strokeWidth="2" />
      <rect x="4" y="22" width="38" height="20" fill="currentColor" />
      <rect x="40" y="10" width="3" height="44" className={styles.accent} />
      <rect x="15" y="26" width="3" height="12" className={styles.surface} />
      <polygon points="18,32 25,26 28,26 21,32 28,38 25,38" className={styles.surface} />
    </svg>
  );

  if (variant === 'glyph') return glyph;

  return (
    <span className={[styles.lockup, className].filter(Boolean).join(' ')} aria-label={title}>
      {glyph}
      <span className={styles.wordmark} aria-hidden="true">
        KVORUM
      </span>
    </span>
  );
}

export default Logo;
