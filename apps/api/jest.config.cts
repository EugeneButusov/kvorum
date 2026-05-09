/** @type {import('jest').Config} */
module.exports = {
  displayName: 'api',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  testMatch: ['**/*.spec.ts', '**/*.test.ts'],
  moduleNameMapper: {
    '^@kvorum/domain$': '<rootDir>/../../libs/domain/src/index.ts',
    '^@kvorum/db$': '<rootDir>/../../libs/db/src/index.ts',
    '^@kvorum/chain$': '<rootDir>/../../libs/chain/src/index.ts',
    '^@kvorum/ai$': '<rootDir>/../../libs/ai/src/index.ts',
  },
  coverageDirectory: '../../coverage/apps/api',
};
