import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['src/lib/vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'worker/**/*.test.ts'],
  },
});
