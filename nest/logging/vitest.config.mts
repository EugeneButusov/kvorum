import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/nest-logging',
  plugins: [tsconfigPaths()],
  test: {
    name: 'nest-logging',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,mts,cts}'],
    reporters: ['default'],
    passWithNoTests: true,
  },
});
