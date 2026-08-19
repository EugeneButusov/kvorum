/**
 * Kvorum branding injected into the Swagger UI shell at GET /v1/docs.
 *
 * Swagger UI renders its own topbar and owns the light/dark state, so both are adjusted
 * from a small script handed to SwaggerModule as `customJsStr`. The visual rules live in
 * `swagger-theme.css`; this file only supplies the markup and the state shim.
 */

/**
 * Brand glyph — the quorum-threshold bar from the dashboard's `Logo` component
 * (apps/dashboard/src/components/brand/Logo.tsx), with that component's CSS-module fills
 * inlined as the equivalent tokens: `currentColor` for the bar, `--accent` for the
 * threshold line, `--bg-2` for the carved K.
 */
const BRAND_GLYPH_SVG = [
  '<svg class="kv-brand-glyph" viewBox="0 0 64 64" fill="none" role="img" aria-label="Kvorum">',
  '<rect x="4" y="22" width="56" height="20" fill="none" stroke="currentColor" stroke-width="2"/>',
  '<rect x="4" y="22" width="38" height="20" fill="currentColor"/>',
  '<rect x="40" y="10" width="3" height="44" fill="var(--accent)"/>',
  '<rect x="15" y="26" width="3" height="12" fill="var(--bg-2)"/>',
  '<polygon points="18,32 25,26 28,26 21,32 28,38 25,38" fill="var(--bg-2)"/>',
  '</svg>',
].join('');

/**
 * Favicon. Standalone rather than reusing BRAND_GLYPH_SVG: at 16px the mark needs its own
 * opaque backing plate and literal colours, since a data-URI document cannot see the
 * page's custom properties.
 */
const FAVICON_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">',
  '<rect width="64" height="64" fill="#f7f7f4"/>',
  '<rect x="4" y="22" width="56" height="20" fill="none" stroke="#1a1a18" stroke-width="2"/>',
  '<rect x="4" y="22" width="38" height="20" fill="#1a1a18"/>',
  '<rect x="40" y="10" width="3" height="44" fill="#00a86b"/>',
  '<rect x="15" y="26" width="3" height="12" fill="#f7f7f4"/>',
  '<polygon points="18,32 25,26 28,26 21,32 28,38 25,38" fill="#f7f7f4"/>',
  '</svg>',
].join('');

export const FAVICON_DATA_URI = `data:image/svg+xml,${encodeURIComponent(FAVICON_SVG)}`;

/** Where the topbar lockup links back to. */
const DASHBOARD_URL = 'https://app.kvorum.watch';

/**
 * Storage key for the light/dark choice. Deliberately the same key the dashboard's
 * next-themes provider uses (apps/dashboard/src/app/layout.tsx), even though localStorage
 * is per-origin and the two cannot actually share a value — keeping them aligned means
 * the docs behave identically and would need no change if the two ever move behind one
 * origin.
 */
const THEME_STORAGE_KEY = 'kv:theme';

/**
 * Runs once Swagger UI has rendered. Two jobs:
 *
 *  1. Persist the theme. Swagger's own topbar toggle flips `dark-mode` on <html> and seeds it
 *     from `prefers-color-scheme`, but forgets the choice on reload. Ordering matters here:
 *     Swagger applies the OS preference *after* this script is evaluated, so a stored choice
 *     has to be re-applied once its toggle exists, and the observer that records changes must
 *     not start until then — otherwise Swagger's transient value immediately overwrites the
 *     preference the reader actually picked.
 *  2. Replace the Swagger wordmark with the Kvorum lockup and a link home.
 *
 * Delivered as a string (`customJsStr`) rather than a served file so it needs no build step or
 * extra route. Written as ES5-compatible, IIFE-wrapped source: it is inlined verbatim into the
 * shell HTML and never passes through the app's TypeScript pipeline.
 */
export const BOOTSTRAP_JS = `
(function () {
  var STORAGE_KEY = '${THEME_STORAGE_KEY}';
  var root = document.documentElement;

  function readStored() {
    try {
      return window.localStorage.getItem(STORAGE_KEY);
    } catch (err) {
      return null; // Private mode / storage disabled — fall back to the OS preference.
    }
  }

  function writeStored(value) {
    try {
      window.localStorage.setItem(STORAGE_KEY, value);
    } catch (err) {
      /* Not persisting is survivable; the page still renders in the chosen theme. */
    }
  }

  function applyStoredTheme() {
    var stored = readStored();
    if (stored === 'dark') {
      root.classList.add('dark-mode');
    } else if (stored === 'light') {
      root.classList.remove('dark-mode');
    }
    // Unset: leave whatever Swagger derived from prefers-color-scheme.
  }

  function watchTheme() {
    var last = root.classList.contains('dark-mode');
    new MutationObserver(function () {
      var next = root.classList.contains('dark-mode');
      if (next !== last) {
        last = next;
        writeStored(next ? 'dark' : 'light');
      }
    }).observe(root, { attributes: true, attributeFilter: ['class'] });
  }

  function brandTopbar() {
    var link = document.querySelector('.topbar-wrapper a.link');
    if (!link) {
      return false;
    }
    link.setAttribute('href', '${DASHBOARD_URL}');
    link.setAttribute('rel', 'noopener noreferrer');
    link.innerHTML = '${BRAND_GLYPH_SVG}' + '<span class="kv-brand-word">KVORUM</span>';

    var wrapper = link.parentNode;
    if (wrapper && !wrapper.querySelector('.kv-brand-title')) {
      var sep = document.createElement('span');
      sep.className = 'kv-brand-sep';
      var title = document.createElement('span');
      title.className = 'kv-brand-title';
      title.textContent = 'API Reference';
      var spacer = document.createElement('span');
      spacer.className = 'kv-topbar-spacer';
      // Insert after the lockup so the toggle Swagger appended stays at the far right.
      link.insertAdjacentElement('afterend', spacer);
      link.insertAdjacentElement('afterend', title);
      link.insertAdjacentElement('afterend', sep);
    }
    return true;
  }

  // Swagger owns the theme class and renders asynchronously, so treat its toggle appearing as
  // the signal that it has finished seeding the theme and the topbar is there to brand.
  function onSwaggerReady() {
    applyStoredTheme();
    watchTheme();
    brandTopbar();
  }

  // Swagger's shell HTML declares no viewport meta, so a phone lays the page out at the
  // ~980px fallback width and zooms out — the responsive rules in the theme could never
  // fire. The shell is not ours to edit, so add it here; browsers re-evaluate the viewport
  // when the tag is inserted.
  function ensureViewportMeta() {
    if (document.querySelector('meta[name="viewport"]')) {
      return;
    }
    var meta = document.createElement('meta');
    meta.setAttribute('name', 'viewport');
    meta.setAttribute('content', 'width=device-width, initial-scale=1');
    document.head.appendChild(meta);
  }

  ensureViewportMeta();

  // Pre-empt the common case where the shell is already painted by the time this runs; the
  // ready handler re-applies regardless, which is what makes the reload order correct.
  applyStoredTheme();

  if (document.querySelector('.dark-mode-toggle button')) {
    onSwaggerReady();
  } else {
    var attempts = 0;
    var timer = setInterval(function () {
      if (document.querySelector('.dark-mode-toggle button')) {
        clearInterval(timer);
        onSwaggerReady();
      } else if (++attempts > 60) {
        clearInterval(timer);
        // Swagger never rendered its toggle; still honour the stored theme and brand what is there.
        onSwaggerReady();
      }
    }, 50);
  }
})();
`.trim();
