import { resolve } from 'node:path';
import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

const root = resolve(__dirname, '../..');

const alias = {
  '@libs/domain': resolve(root, 'libs/domain/src/index.ts'),
  '@libs/db': resolve(root, 'libs/db/src/index.ts'),
  '@libs/chain': resolve(root, 'libs/chain/src/index.ts'),
  '@libs/ai': resolve(root, 'libs/ai/src/index.ts'),
  '@libs/utils': resolve(root, 'libs/utils/src/index.ts'),
  '@libs/observability': resolve(root, 'libs/observability/src/index.ts'),
  '@sources/core': resolve(root, 'libs/sources/core/src/index.ts'),
  '@sources/compound': resolve(root, 'libs/sources/compound/src/index.ts'),
  '@nest/chain': resolve(root, 'nest/chain/src/index.ts'),
  '@nest/compound': resolve(root, 'nest/sources/compound/src/index.ts'),
  '@nest/observability': resolve(root, 'nest/observability/src/index.ts'),
};

export default defineConfig({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/apps/indexer',
  // Vite 8 uses Oxc by default. Enable legacy decorator metadata so that
  // NestJS DI can resolve constructor injections in integration tests that
  // call NestFactory.createApplicationContext.
  oxc: {
    decorator: {
      legacy: true,
      emitDecoratorMetadata: true,
    },
  },
  plugins: [tsconfigPaths()],
  resolve: { alias },
  test: {
    reporters: ['default'],
    passWithNoTests: true,
    coverage: {
      reportsDirectory: '../../coverage/apps/indexer',
      provider: 'v8' as const,
    },
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'indexer',
          globals: true,
          environment: 'node',
          include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
          exclude: ['**/*.integration.spec.*', '**/node_modules/**'],
          setupFiles: ['./tests/helpers/vitest.setup.ts'],
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'indexer-integration',
          globals: true,
          environment: 'node',
          include: ['tests/**/*.integration.spec.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
          pool: 'forks',
          fileParallelism: false,
          setupFiles: ['./tests/helpers/vitest.setup.ts'],
        },
      },
    ],
  },
});
