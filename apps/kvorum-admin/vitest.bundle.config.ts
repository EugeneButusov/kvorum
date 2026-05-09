import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/apps/kvorum-admin-bundle',
  plugins: [tsconfigPaths()],
  test: {
    name: 'kvorum-admin-bundle',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['src/main.spec.ts'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../coverage/apps/kvorum-admin-bundle',
      provider: 'v8' as const,
    },
  },
});
