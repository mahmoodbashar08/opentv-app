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
    // expo-file-system ships untranspiled ESM, which this deliberately
    // preset-free Node runner cannot parse. `community-seed.ts` imports it only
    // to turn a filename into a `file://` URI for the image upload; nothing
    // under test touches the filesystem, so a stub keeps the module importable
    // without dragging in jest-expo for one type.
    '^expo-file-system$': '<rootDir>/src/__mocks__/expo-file-system.ts',
    // Same story, one module along: `plus.ts` imports the router to push the
    // paywall, and `community-publish.ts` imports `plus.ts` to know whether the
    // publish caps apply — so the whole of React Native was being dragged into
    // a suite that tests set arithmetic. Navigation is not what these tests are
    // about; the stub keeps the module importable.
    '^expo-router$': '<rootDir>/src/__mocks__/expo-router.ts',
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.jest.json' }],
  },
};
