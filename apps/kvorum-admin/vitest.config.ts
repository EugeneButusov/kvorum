import { defineConfig } from 'vitest/config';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/apps/kvorum-admin',
  plugins: [nxViteTsPaths()],
  test: {
    name: 'kvorum-admin',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    exclude: ['src/main.spec.ts'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../coverage/apps/kvorum-admin',
      provider: 'v8' as const,
    },
  },
}));
