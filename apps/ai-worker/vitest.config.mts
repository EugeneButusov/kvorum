import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/apps/ai-worker',
  plugins: [tsconfigPaths()],
  test: {
    name: 'ai-worker',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    passWithNoTests: true,
    setupFiles: ['./tests/helpers/vitest.setup.ts'],
    coverage: {
      reportsDirectory: '../../coverage/apps/ai-worker',
      provider: 'v8' as const,
    },
  },
});
