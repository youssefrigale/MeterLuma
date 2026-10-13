import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  workers: 4,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:1420' },
  projects: [{ name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1180, height: 860 } } }],
  webServer: { command: 'npm run dev', url: 'http://127.0.0.1:1420', reuseExistingServer: !process.env.CI },
});
