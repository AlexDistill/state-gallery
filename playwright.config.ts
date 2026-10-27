import { defineConfig } from "@playwright/test";
// Video-note specs get their own server: sign-in routes allow 15 attempts a minute per
// server, and the review loop alone uses most of that.
const server = (port: number, data: string) => ({
  command: `STATE_GALLERY_DATA=${data} STATE_GALLERY_OWNER_SECRET=e2e-local-secret PORT=${port} npm start`,
  url: `http://localhost:${port}`,
  reuseExistingServer: false,
});
export default defineConfig({
  globalSetup: "tests/e2e/setup.ts",
  testDir: "tests/e2e",
  workers: 1,
  timeout: 60000,
  use: {
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
    // Recording tests use Chromium's fake microphone and auto-accept the permission prompt.
    launchOptions: {
      args: [
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
      ],
    },
  },
  projects: [
    {
      name: "review",
      testMatch: "review-loop.spec.ts",
      use: { baseURL: "http://localhost:4201" },
    },
    {
      name: "video-notes",
      testMatch: ["recording.spec.ts", "pin-decisions.spec.ts"],
      use: { baseURL: "http://localhost:4202" },
    },
  ],
  webServer: [server(4201, ".data/e2e"), server(4202, ".data/e2e-notes")],
  reporter: [["list"], ["html", { open: "never" }]],
});
