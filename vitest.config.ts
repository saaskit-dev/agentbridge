import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'packages/**/src/**/__tests__/**/*.test.ts',
      'apps/**/src/**/__tests__/**/*.test.ts',
      'apps/**/sources/**/__tests__/**/*.test.{ts,tsx}',
      'src/**/__tests__/**/*.test.ts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**'],
    testTimeout: 30000,
    hookTimeout: 30000,
    // Use jsdom for React tests
    environmentMatchGlobs: [['apps/free/app/**', 'jsdom']],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/**', 'dist/**', '**/*.d.ts', '**/__tests__/**'],
    },
  },
  resolve: {
    alias: [
      {
        find: /^@\/(.*)$/,
        replacement: path.resolve(__dirname, 'apps/free/cli/src/$1'),
      },
      {
        find: 'libsodium-wrappers',
        replacement: path.resolve(
          __dirname,
          'node_modules/.pnpm/libsodium-wrappers@0.7.15/node_modules/libsodium-wrappers/dist/modules/libsodium-wrappers.js'
        ),
      },
    ],
  },
});
