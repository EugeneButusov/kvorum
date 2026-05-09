import nx from '@nx/eslint-plugin';

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/node_modules/**',
      '**/libs/db/src/generated/**',
      '**/vitest.config.*.timestamp*',
    ],
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: ['^.*/eslint(\\.base)?\\.config\\.[cj]s$'],
          depConstraints: [
            {
              sourceTag: 'scope:domain',
              onlyDependOnLibsWithTags: [],
            },
            {
              sourceTag: 'scope:db',
              onlyDependOnLibsWithTags: ['scope:domain'],
            },
            {
              sourceTag: 'scope:chain',
              onlyDependOnLibsWithTags: ['scope:domain'],
            },
            {
              sourceTag: 'scope:ai',
              onlyDependOnLibsWithTags: ['scope:domain'],
            },
            {
              sourceTag: 'scope:app',
              onlyDependOnLibsWithTags: ['scope:domain', 'scope:db', 'scope:chain', 'scope:ai'],
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {},
  },
  {
    files: ['**/*.js', '**/*.jsx'],
    rules: {},
  },
];
