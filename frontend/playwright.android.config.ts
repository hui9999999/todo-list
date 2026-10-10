import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests', testMatch: 'android.spec.ts', workers: 1, timeout: 45000,
  use: { baseURL: 'http://127.0.0.1:5178', channel: 'chrome', viewport: { width: 390, height: 844 }, trace: 'retain-on-failure' },
  // Exercise the same production bundle that goes into the APK, without development optimizer reloads.
  webServer: { command: 'npm run build:android && npx vite preview --outDir dist-android --host 127.0.0.1 --port 5178 --strictPort', url: 'http://127.0.0.1:5178', reuseExistingServer: false },
});
