/**
 * Minimal test setup for the pure logic in src/pure.ts (no React Native / expo
 * imports), so it runs in plain Node without the heavy jest-expo preset.
 * Isolated-modules transpile avoids typechecking against the RN app tsconfig.
 */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.jest.json' }],
  },
};
