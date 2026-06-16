import nextPlugin from '@next/eslint-plugin-next';
import importPlugin from 'eslint-plugin-import';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/node_modules/**',
      '**/libs/db/src/generated/**',
      '**/vitest.config.*.timestamp*',
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ['apps/dashboard/**/*.{ts,tsx,js,jsx}'],
    plugins: { '@next/next': nextPlugin },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
    },
  },
  {
    plugins: { import: importPlugin },
    rules: {
      'import/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', ['parent', 'sibling', 'index']],
          pathGroups: [
            { pattern: '@libs/**', group: 'internal', position: 'before' },
            { pattern: '@sources/**', group: 'internal', position: 'before' },
            { pattern: '@nest/**', group: 'internal', position: 'before' },
          ],
          pathGroupsExcludedImportTypes: ['builtin'],
          'newlines-between': 'ignore',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['**/*.js', '**/*.jsx', '**/*.mjs', '**/*.cjs'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    // apps/api must stay source-blind: reach sources only via @nest/source-api.
    files: ['apps/api/src/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: ['@sources/*'] }],
    },
  },
  {
    // @nest/source-api may only import the light /api subpaths, not the heavy barrels.
    files: ['nest/source-api/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@sources/aave',
              message: 'Import from @sources/aave/api instead of the barrel.',
            },
            {
              name: '@sources/compound',
              message: 'Import from @sources/compound/api instead of the barrel.',
            },
            {
              name: '@sources/core',
              message: 'Use @libs/domain for shared types instead of the barrel.',
            },
          ],
        },
      ],
    },
  },
);
