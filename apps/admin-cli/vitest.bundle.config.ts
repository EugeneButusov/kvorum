import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig(() => ({
  root: __dirname,
  plugins: [tsconfigPaths()],
  test: {
    name: 'admin-cli-bundle',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['src/main.spec.ts'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../coverage/apps/admin-cli-bundle',
      provider: 'v8' as const,
    },
  },
}));
