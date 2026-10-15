import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  define: { __APP_VERSION__: JSON.stringify(version) },
  // Keep the watcher out of native build output, local toolchains and agent worktrees; crawling them stalls first page loads.
  server: { port: 1420, strictPort: true, watch: { ignored: ['**/src-tauri/**', '**/.tools/**', '**/.claude/**', '**/artifacts/**', '**/playwright-report/**', '**/test-results/**'] } },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  // Platform floor: WebView2 (Chromium 110+) on Windows and WKWebView on macOS 13 (Safari 16).
  build: { target: ['es2022', 'chrome110', 'safari16'], cssTarget: ['chrome110', 'safari16'] },
});
