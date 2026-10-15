import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.METERLUMA_WEBKIT_TEST_PORT ?? 1432);

export default defineConfig({
  testDir: './tests',
  workers: 4,
  reporter: 'list',
  use: { baseURL: `http://127.0.0.1:${port}` },
  projects: [{ name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1180, height: 860 } } }],
  webServer: { command: `npm run dev -- --port ${port}`, url: `http://127.0.0.1:${port}`, reuseExistingServer: !process.env.CI },
});
