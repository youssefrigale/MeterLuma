import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests-release', workers: 2, timeout: 60000, reporter: 'list',
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:1422', viewport: { width: 1180, height: 860 } },
  webServer: { command: 'npm run preview -- --port 1422', url: 'http://127.0.0.1:1422', reuseExistingServer: false },
});
