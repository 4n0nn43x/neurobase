/** Jest config — ts-jest with sensible defaults */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests', '<rootDir>/src'],
  testMatch: ['**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/dashboard/**',
    '!src/scripts/init-db.ts',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text-summary', 'html'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json', isolatedModules: true }],
  },
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
};
