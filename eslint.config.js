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
      // Design reference bundle: hand-authored HTML/CSS/JS mocks, not application source.
      'docs/design/**',
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
    // apps/api must stay source-blind: reach source plugins (incl. API contributions)
    // via @nest/sources, and dispatch helpers/types via @libs/domain — never @sources/*.
    files: ['apps/api/src/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: ['@sources/*'] }],
    },
  },
);
