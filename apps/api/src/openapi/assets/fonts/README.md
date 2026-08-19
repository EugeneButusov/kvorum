# Vendored brand typefaces (API docs only)

These two variable fonts back the Kvorum theme applied to Swagger UI at `GET /v1/docs`.
They are served statically under `/v1/docs-assets/fonts/` (wired in `apps/api/src/main.ts`)
and referenced by the `@font-face` block at the top of `../swagger-theme.css`.

## Why vendored rather than resolved from node_modules

`apps/api` webpack-bundles to a single `dist/apps/api/main.js` and externalises
`node_modules`, so there is no build step that would copy package assets into `dist/`.
Resolving a pnpm symlink path at runtime would depend on the store layout and on the
process cwd (repo root under the Docker `CMD`, `apps/api` under `pnpm --filter api start`).
Committing the two files keeps the docs route working identically in both.

## Why not Google Fonts

The dashboard deliberately self-hosts these faces via `next/font` (ADR-077 §1) and the
site ships no third-party requests (DR-017, cookieless analytics). The docs page is on a
different origin and cannot reuse the dashboard's copies, so it carries its own.

## Provenance

Copied verbatim from the Fontsource packages pinned in `apps/api/package.json`:

| File                                     | Package                               | Version |
| ---------------------------------------- | ------------------------------------- | ------- |
| `inter-latin-wght-normal.woff2`          | `@fontsource-variable/inter`          | 5.3.0   |
| `jetbrains-mono-latin-wght-normal.woff2` | `@fontsource-variable/jetbrains-mono` | 5.3.0   |

Latin subset, weight-axis variable, normal style only — the docs page uses no italic.

To re-vendor after bumping either package:

```bash
pnpm --filter api fonts:vendor
```

## Licence

Both faces are SIL Open Font License 1.1; the licence text ships alongside them as
`inter-OFL.txt` and `jetbrains-mono-OFL.txt`, as the OFL requires.
