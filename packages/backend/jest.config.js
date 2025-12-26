module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: ['**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(agentdb)/)',
  ],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/server.ts',
  ],
  moduleNameMapper: {
    '^@devflow-studio/shared$': '<rootDir>/../shared/src',
  },
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  testTimeout: 30000,
  // Workaround for monorepo Jest module resolution
  resolver: undefined,
  // Explicitly set module paths to help Jest find dependencies
  modulePaths: ['<rootDir>/node_modules', '<rootDir>/../../node_modules'],
};

