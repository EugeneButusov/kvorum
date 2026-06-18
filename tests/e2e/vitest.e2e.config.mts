import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/tests/e2e',
  plugins: [tsconfigPaths()],
  test: {
    name: 'e2e',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['**/*.e2e.spec.ts'],
    reporters: ['default'],
    passWithNoTests: true,
    setupFiles: ['./vitest.setup.ts'],
    fileParallelism: false,
    maxConcurrency: 1,
  },
});
