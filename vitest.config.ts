import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts'],
    testTimeout: 15000,
    hookTimeout: 15000,
    retry: process.env.CI ? 1 : 0,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules', 'dist', 'npm/dist', 'npm/bin', '**/*.config.*', '**/*.test.ts'],
      thresholds: {
        statements: 83,
        branches: 72,
        functions: 85,
        lines: 85,
        'packages/core/src/**/*.ts': {
          statements: 80,
          branches: 75,
          functions: 80,
          lines: 80,
        },
      },
    },
  },
});
