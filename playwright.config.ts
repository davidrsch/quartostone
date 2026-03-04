import { defineConfig, devices } from '@playwright/test';

const E2E_PORT = parseInt(process.env['E2E_PORT'] ?? '4343', 10);

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  // Retry twice on CI to absorb flakiness; zero retries locally for fast feedback.
  retries: process.env['CI'] ? 2 : 0,
  // On CI: emit GitHub check annotations + HTML report for artifacts.
  // Locally: interactive HTML report only.
  reporter: process.env['CI'] ? [['github'], ['html', { outputFolder: 'playwright-report' }]] : 'html',
  use: {
    baseURL: `http://localhost:${E2E_PORT}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  // Start a real Quartostone server against the fixture workspace before running E2E tests.
  webServer: {
    command: 'npx tsx tests/e2e/fixtures/start-server.ts',
    // /api/health always returns 200 — avoids false 404 when _site/ doesn't exist.
    url: `http://localhost:${E2E_PORT}/api/health`,
    reuseExistingServer: !process.env['CI'],
    timeout: 30_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
