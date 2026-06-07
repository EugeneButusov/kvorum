import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: __dirname,
  cacheDir: '../../../node_modules/.vite/libs/sources/aave-integration',
  plugins: [tsconfigPaths()],
  test: {
    name: 'sources-aave-integration',
    watch: false,
    globals: true,
    environment: 'node',
    pool: 'forks',
    fileParallelism: false,
    minWorkers: 1,
    maxWorkers: 1,
    setupFiles: ['./vitest.integration.setup.ts'],
    include: ['tests/**/*.integration.spec.{ts,mts}'],
    passWithNoTests: true,
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../../coverage/libs/sources/aave-integration',
      provider: 'v8' as const,
    },
  },
});
