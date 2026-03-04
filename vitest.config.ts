import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Strip .js extension from relative imports so Vitest finds the .ts source files.
    // Required for TypeScript ESM projects that use "import './foo.js'" conventions.
    alias: [{ find: /^(\.{1,2}\/.*?)\.js$/, replacement: '$1' }],
  },
  test: {
    // Default environment for server tests.  Client unit tests opt-in via
    // the `// @vitest-environment happy-dom` comment at the top of the file.
    environment: 'node',
    // Increase timeout for coverage runs where git operations (which spawn
    // real child processes) can take longer under v8 instrumentation.
    testTimeout: 15000,
    include: [
      'tests/unit/**/*.test.ts',
      'tests/integration/**/*.test.ts',
    ],
    coverage: {
      provider: 'v8',
      include: ['src/server/**/*.ts'],
      // Exclude files that require external processes (Quarto render, chokidar)
      // or real HTTP/WebSocket infrastructure — those are covered by E2E tests.
      exclude: [
        'src/server/watcher.ts',  // chokidar file-watch loop; tested via E2E
        'src/server/api/render.ts',   // `quarto` subprocess; tested via E2E
        'src/server/api/preview.ts',  // `quarto` subprocess + live TCP; tested via E2E
      ],
      reporter: ['text', 'lcov', 'html'],
      thresholds: {
        lines:      85,
        functions:  87,
        statements: 84,
        // branches are harder to reach — error catch paths in createServer/fetch
        // and unreachable `else` branches require full E2E infrastructure.
        branches:   70,
      },
    },
  },
});

