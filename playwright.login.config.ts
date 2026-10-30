import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/private-login.spec.ts',
  outputDir: 'test-results/login',
  use: { baseURL: 'http://127.0.0.1:5184', serviceWorkers: 'block', trace: 'retain-on-failure' },
  projects: [
    { name: 'login-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'login-mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
  ],
  webServer: {
    command: 'node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 5184 --strictPort',
    url: 'http://127.0.0.1:5184',
    reuseExistingServer: false,
  },
});
