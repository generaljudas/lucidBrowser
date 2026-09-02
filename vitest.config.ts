import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['core/test/**/*.test.ts', 'app/test/**/*.test.ts'],
  },
});
