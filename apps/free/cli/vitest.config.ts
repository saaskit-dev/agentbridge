import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    projects: [
      {
        resolve: {
          alias: {
            '@': resolve('./src'),
          },
        },
        test: {
          name: 'unit',
          globals: false,
          environment: 'node',
          include: ['src/**/*.test.ts'],
          exclude: ['src/**/*.integration.test.ts'],
        },
      },
      {
        resolve: {
          alias: {
            '@': resolve('./src'),
          },
        },
        test: {
          name: 'integration',
          globals: false,
          environment: 'node',
          include: ['src/**/*.integration.test.ts'],
          globalSetup: ['./src/test-setup.ts'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/**', 'dist/**', '**/*.d.ts', '**/*.config.*', '**/mockData/**'],
    },
  },
  resolve: {
    alias: {
      '@': resolve('./src'),
    },
  },
});
