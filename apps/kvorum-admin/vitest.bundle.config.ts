import { defineConfig } from 'vitest/config';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/apps/kvorum-admin-bundle',
  plugins: [nxViteTsPaths()],
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
}));
