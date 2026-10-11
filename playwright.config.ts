import { defineConfig } from "@playwright/test";
export default defineConfig({
  globalSetup: "tests/e2e/setup.ts",
  testDir: "tests/e2e",
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: "http://localhost:4201",
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
  },
  webServer: {
    command:
      "STATE_GALLERY_DATA=.data/e2e STATE_GALLERY_OWNER_SECRET=e2e-local-secret PORT=4201 npm start",
    url: "http://localhost:4201",
    reuseExistingServer: false,
  },
  reporter: [["list"], ["html", { open: "never" }]],
});
