/** @type {import('jest').Config} */
module.exports = {
  displayName: 'indexer',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  testMatch: ['**/*.spec.ts', '**/*.test.ts'],
  moduleNameMapper: {
    '^@libs/domain$': '<rootDir>/../../libs/domain/src/index.ts',
    '^@libs/db$': '<rootDir>/../../libs/db/src/index.ts',
    '^@libs/chain$': '<rootDir>/../../libs/chain/src/index.ts',
    '^@libs/ai$': '<rootDir>/../../libs/ai/src/index.ts',
    '^@libs/utils$': '<rootDir>/../../libs/utils/src/index.ts',
  },
  coverageDirectory: '../../coverage/apps/indexer',
};
