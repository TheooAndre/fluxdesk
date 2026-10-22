import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  timeout: 30_000,
  retries: 1,
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    // Useful local mobile regression coverage even on macOS versions where
    // Playwright's frozen WebKit builds cannot launch.
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
    // Keep WebKit projects available for supported macOS / CI environments.
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'mobile-ios', use: { ...devices['iPhone 13'] } },
  ],
  webServer: {
    // Market APIs are mocked in E2E: avoid coupling frontend tests to the
    // websocket/backend processes started by the combined pnpm dev script.
    command: 'pnpm exec vite --host 127.0.0.1 --port 5173 --strictPort',
    // Check the identical IPv4 origin used by page.goto (not localhost/IPv6).
    url: 'http://127.0.0.1:5173/',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
