import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/openwebui.test.ts'],
    globals: true,
    environment: 'node',
    testTimeout: 10000,
  },
});
