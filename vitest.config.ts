import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Strip .js extension from relative imports so Vitest finds the .ts source files.
    // Required for TypeScript ESM projects that use "import './foo.js'" conventions.
    alias: [{ find: /^(\.{1,2}\/.*?)\.js$/, replacement: '$1' }],
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/server/**/*.ts'],
      // Exclude files that require external processes (Quarto render, chokidar)
      // or real HTTP/WebSocket infrastructure — those are covered by E2E tests.
      exclude: [
        'src/server/watcher.ts',  // chokidar file-watch loop; tested via E2E
        'src/server/api/render.ts', // `quarto` subprocess; tested via E2E
      ],
      reporter: ['text', 'lcov', 'html'],
      thresholds: {
        lines: 60,
        functions: 65,
        branches: 45,
        statements: 60,
      },
    },
  },
});

