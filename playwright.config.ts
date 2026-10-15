import { defineConfig, devices } from '@playwright/test';

// A dedicated port, so tests never reuse a `tauri dev` server (1420) that may be serving another checkout.
const port = Number(process.env.METERLUMA_TEST_PORT ?? 1431);

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: `http://127.0.0.1:${port}`, trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } },
    { name: 'compact', use: { ...devices['Desktop Chrome'], viewport: { width: 430, height: 780 } } },
  ],
  webServer: { command: `npm run dev -- --port ${port}`, url: `http://127.0.0.1:${port}`, reuseExistingServer: !process.env.CI },
});
