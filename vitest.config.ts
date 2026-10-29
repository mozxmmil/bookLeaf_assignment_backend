import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false, // tests share one Postgres database
    testTimeout: 20000,
    hookTimeout: 60000,
    globalSetup: './tests/globalSetup.ts',
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:bookleaf@localhost:5440/bookleaf_test',
      JWT_SECRET: 'test-secret-test-secret-test-secret-123',
      GEMINI_API_KEY: '',
      AI_TIMEOUT_MS: '2000',
    },
  },
});
