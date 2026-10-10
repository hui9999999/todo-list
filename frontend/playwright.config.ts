import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testIgnore: 'android.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: "http://localhost:5174",
    channel: "chrome",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        channel: "chrome",
      },
    },
    {
      name: "mobile",
      use: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        deviceScaleFactor: 1,
        channel: "chrome",
      },
    },
  ],
});
