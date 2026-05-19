import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: __dirname,
  cacheDir: '../../../node_modules/.vite/libs/sources/compound-integration',
  plugins: [tsconfigPaths()],
  test: {
    name: 'sources-compound-integration',
    watch: false,
    globals: true,
    environment: 'node',
    pool: 'forks',
    fileParallelism: false,
    setupFiles: ['./vitest.setup.ts'],
    include: ['tests/**/*.integration.spec.{ts,mts}'],
    passWithNoTests: true,
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../../coverage/libs/sources/compound-integration',
      provider: 'v8' as const,
    },
  },
});
