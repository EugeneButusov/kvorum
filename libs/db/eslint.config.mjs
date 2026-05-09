import baseConfig from '../../eslint.config.js';

export default [
  ...baseConfig,
  {
    files: ['**/*.json'],
    rules: {
      '@nx/dependency-checks': [
        'error',
        {
          ignoredFiles: [
            '{projectRoot}/eslint.config.{js,cjs,mjs,ts,cts,mts}',
            '{projectRoot}/vite.config.{js,ts,mjs,mts}',
            '{projectRoot}/vitest.config.{js,ts,mjs,mts}',
          ],
          ignoredDependencies: [
            'vitest',
            '@nx/vite',
            '@nx/vitest',
            '@vitest/coverage-v8',
            '@nestjs/common',
            '@nestjs/core',
            'reflect-metadata',
            '@prisma/client',
            'prisma',
          ],
        },
      ],
    },
    languageOptions: {
      parser: await import('jsonc-eslint-parser'),
    },
  },
];
