import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/libs/observability',
  plugins: [tsconfigPaths()],
  test: {
    name: 'observability',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      enabled: !!process.env['CI'],
      reportsDirectory: '../../coverage/libs/observability',
      provider: 'v8' as const,
      reporter: ['text', 'json-summary', 'html'],
      thresholds: { lines: 90, functions: 90, branches: 90 },
    },
  },
});
