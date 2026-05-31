import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: __dirname,
  cacheDir: '../../../node_modules/.vite/libs/sources/compound',
  plugins: [tsconfigPaths()],
  test: {
    name: 'sources-compound',
    watch: false,
    globals: true,
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    exclude: ['tests/**/*.integration.spec.{ts,mts}'],
    passWithNoTests: true,
    reporters: ['default'],
    coverage: {
      enabled: !!process.env['CI'],
      reportsDirectory: '../../../coverage/libs/sources/compound',
      provider: 'v8' as const,
      reporter: ['text', 'json-summary', 'html'],
      thresholds: { lines: 70, functions: 70, branches: 55 },
    },
  },
});
