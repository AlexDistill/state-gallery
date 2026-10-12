import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export async function createCaptureStarter(directory: string) {
  await mkdir(directory, { recursive: true });
  const file = resolve(directory, "state-gallery.capture.mjs");
  try {
    await writeFile(
      file,
      `import { chromium } from "playwright";
import { captureJourney } from "@state-gallery/review/capture";

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  // Add your authentication/fixtures here. The page stays owned by your app.
  const manifest = await captureJourney(page, {
    title: "App journey",
    directory: "./state-gallery-captures",
    steps: [
      // Add named screens in journey order; show() can navigate, click or load fixtures.
      {
        id: "home",
        title: "Home",
        purpose: "Introduce the experience",
        transition: "Continue to the next step",
        viewport: { width: 1440, height: 900 },
        show: async (page) => {
          await page.goto(process.env.STATE_GALLERY_APP_URL ?? "http://localhost:3000");
        },
      },
    ],
  });
  console.log("Captured " + manifest.steps.length + " screen(s): state-gallery-captures/manifest.json (" + manifest.coverage + ")");
  if (manifest.coverage !== "complete") process.exitCode = 1;
} finally {
  await browser.close();
}
`,
      { flag: "wx" },
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new Error(
        "state-gallery.capture.mjs already exists. Your capture setup was preserved.",
      );
    throw error;
  }
  return file;
}
