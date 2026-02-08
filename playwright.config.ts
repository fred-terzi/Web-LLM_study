import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright configuration for WebLLM UI e2e tests.
 *
 * Supports two modes:
 * 1. Local: starts a Vite dev server and tests against it.
 * 2. Deployed: set BASE_URL env var to test a deployed site (e.g. GitHub Pages).
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "html",
  timeout: 30_000,

  use: {
    baseURL: process.env.BASE_URL || "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: [
            "--enable-unsafe-webgpu",
            "--enable-features=Vulkan",
            "--disable-gpu-sandbox",
          ],
        },
      },
    },
  ],

  /* Start local dev server only when no BASE_URL is provided */
  ...(process.env.BASE_URL
    ? {}
    : {
        webServer: {
          command: "npm run dev",
          url: "http://localhost:3000",
          reuseExistingServer: !process.env.CI,
          timeout: 30_000,
        },
      }),
});
