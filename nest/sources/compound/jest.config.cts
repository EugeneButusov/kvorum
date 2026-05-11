/** @type {import('jest').Config} */
module.exports = {
  displayName: 'nest-sources-compound',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  testMatch: ['**/*.spec.ts', '**/*.test.ts'],
  moduleNameMapper: {
    '^@libs/domain$': '<rootDir>/../../../libs/domain/src/index.ts',
    '^@libs/db$': '<rootDir>/../../../libs/db/src/index.ts',
    '^@libs/chain$': '<rootDir>/../../../libs/chain/src/index.ts',
    '^@libs/utils$': '<rootDir>/../../../libs/utils/src/index.ts',
    '^@sources/compound$': '<rootDir>/../../../libs/sources/compound/src/index.ts',
    '^@nest/compound$': '<rootDir>/src/index.ts',
  },
  coverageDirectory: '../../../coverage/nest/sources/compound',
};
