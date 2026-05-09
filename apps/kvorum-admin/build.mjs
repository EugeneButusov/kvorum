#!/usr/bin/env node
// Build script for kvorum-admin.
// Handles: version injection, ESM-compatible banner with CJS require polyfill.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '../..');
const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf8'));

// The banner injects a CJS-compatible `require` so that bundled CJS
// dependencies (commander) can call require() inside an ESM context.
const banner = [
  '#!/usr/bin/env node',
  "import { createRequire as __cjsRequire } from 'module';",
  'const require = __cjsRequire(import.meta.url);',
].join('\n');

const outDir = join(root, 'dist/apps/kvorum-admin');
mkdirSync(outDir, { recursive: true });

execFileSync(
  join(root, 'node_modules/.bin/esbuild'),
  [
    'apps/kvorum-admin/src/main.ts',
    '--bundle',
    '--platform=node',
    '--target=node24',
    '--format=esm',
    '--outfile=dist/apps/kvorum-admin/main.js',
    `--banner:js=${banner}`,
    `--define:PKG_VERSION="${pkg.version}"`,
  ],
  { stdio: 'inherit', cwd: root },
);

// Write a package.json so Node.js recognises the ESM bundle without a
// MODULE_TYPELESS_PACKAGE_JSON warning (the .js file uses import syntax).
writeFileSync(join(outDir, 'package.json'), '{"type":"module"}\n');
