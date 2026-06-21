import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: __dirname,
  cacheDir: '../../../node_modules/.vite/libs/sources/forum',
  plugins: [tsconfigPaths()],
  test: {
    name: 'sources-forum',
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
      reportsDirectory: '../../../coverage/libs/sources/forum',
      provider: 'v8' as const,
      reporter: ['text', 'json-summary', 'html'],
      thresholds: { lines: 90, functions: 90, branches: 90 },
    },
  },
});
