/**
 * Minimal test setup for the pure logic in src/pure.ts (no React Native / expo
 * imports), so it runs in plain Node without the heavy jest-expo preset.
 * Isolated-modules transpile avoids typechecking against the RN app tsconfig.
 */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/*.test.ts'],
  moduleNameMapper: {
    // `src/api-config.ts` is gitignored and holds the PRODUCTION host. Tests
    // resolve the committed `.example` instead, so the suite runs on a fresh
    // clone and can never accidentally aim at the live Worker.
    '^@/api-config$': '<rootDir>/src/api-config.example.ts',
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.jest.json' }],
  },
};
