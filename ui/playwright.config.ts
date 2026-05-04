import { defineConfig, devices } from "@playwright/test";

const uiPort = Number(process.env.KVIEW_E2E_UI_PORT || "5173");
const backendPort = Number(process.env.KVIEW_E2E_BACKEND_PORT || "10444");
const backendURL = `http://127.0.0.1:${backendPort}`;

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 180_000,
  expect: {
    timeout: 30_000,
  },
  fullyParallel: false,
  workers: 1,
  outputDir: "../.artifacts/playwright/test-results",
  reporter: [["list"], ["html", { outputFolder: "../.artifacts/playwright/html-report", open: "never" }]],
  use: {
    baseURL: `http://127.0.0.1:${uiPort}`,
    trace: "off",
    screenshot: "off",
    video: "off",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : undefined,
  },
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${uiPort} --strictPort`,
    url: `http://127.0.0.1:${uiPort}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      ...process.env,
      KVIEW_E2E_API_TARGET: backendURL,
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: /screenshots\.spec\.ts/,
    },
    {
      name: "screenshots",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1920, height: 1200 },
      },
      testMatch: /screenshots\.spec\.ts/,
    },
  ],
});
