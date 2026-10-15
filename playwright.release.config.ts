import { defineConfig, devices } from '@playwright/test';

// Runs against the production build in dist/ (run `npm run build` first).
const port = Number(process.env.METERLUMA_RELEASE_TEST_PORT ?? 1422);

export default defineConfig({
  testDir: './tests-release', workers: 2, timeout: 60000, reporter: 'list',
  use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${port}`, viewport: { width: 1180, height: 860 } },
  webServer: { command: `npm run preview -- --port ${port} --strictPort`, url: `http://127.0.0.1:${port}`, reuseExistingServer: false },
});
