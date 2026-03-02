import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  // Retry twice on CI to absorb flakiness; zero retries locally for fast feedback.
  retries: process.env['CI'] ? 2 : 0,
  reporter: process.env['CI'] ? 'github' : 'html',
  // Create missing snapshots and pass on first run; compare on subsequent runs.
  updateSnapshots: 'missing',
  use: {
    baseURL: 'http://localhost:4343',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  // Start a real Quartostone server against the fixture workspace before running E2E tests.
  webServer: {
    command: 'npx tsx tests/e2e/fixtures/start-server.ts',
    // /api/health always returns 200 — avoids false 404 when _site/ doesn't exist.
    url: 'http://localhost:4343/api/health',
    reuseExistingServer: !process.env['CI'],
    timeout: 30_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
