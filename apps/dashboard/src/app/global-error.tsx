'use client';

/**
 * Last-resort boundary for errors thrown in the root layout itself — it replaces the whole document,
 * so it must render its own <html>/<body> and can't rely on the app's providers, fonts, or CSS. Kept
 * deliberately minimal and self-contained with inline styles.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          minHeight: '100vh',
          margin: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0.75rem',
          padding: '2rem',
          textAlign: 'center',
          color: '#1a1a1a',
          background: '#f5f5f0',
        }}
      >
        <p style={{ fontSize: '0.75rem', letterSpacing: '0.08em', color: '#6b6b6b' }}>500</p>
        <h1 style={{ fontSize: '1.5rem', margin: 0 }}>Something went wrong</h1>
        <p style={{ maxWidth: '28rem', color: '#4a4a4a' }}>
          Something went wrong on Kvorum’s side. The error has been logged.
        </p>
        {error.digest && (
          <p style={{ fontSize: '0.85rem', color: '#6b6b6b' }}>Error reference: {error.digest}</p>
        )}
        <a href="/" style={{ marginTop: '0.5rem', color: '#1f8a4c' }}>
          ← Home
        </a>
      </body>
    </html>
  );
}
