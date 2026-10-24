import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config.ts';
export default defineConfig({
  ...base,
  testMatch: '**/production.spec.ts',
  testIgnore: [],
  projects: [
    { name: 'production-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'production-mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
    { name: 'production-webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'production-ios', use: { ...devices['iPhone 13'] } },
  ],
  use: { baseURL: 'http://127.0.0.1:5183', trace: 'retain-on-failure', serviceWorkers: 'block' },
  webServer: {
    command: 'node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 5183 --strictPort',
    url: 'http://127.0.0.1:5183/',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
