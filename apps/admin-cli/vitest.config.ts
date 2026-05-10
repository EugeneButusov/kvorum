import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig(() => ({
  root: __dirname,
  plugins: [tsconfigPaths()],
  test: {
    name: 'admin-cli',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    exclude: ['src/main.spec.ts'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../coverage/apps/admin-cli',
      provider: 'v8' as const,
    },
  },
}));
