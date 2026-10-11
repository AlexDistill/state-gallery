import { chromium } from "@playwright/test";
import { captureJourney } from "../../dist/capture/playwright.js";
const browser = await chromium.launch();
try {
  for (const [project, title] of [
    ["shop", "A small shop"],
    ["notes", "A quiet notebook"],
  ]) {
    const page = await browser.newPage();
    const manifest = await captureJourney(page, {
      title,
      directory: `.data/examples/${project}`,
      steps: [
        {
          id: "start",
          title: "Start",
          viewport: { width: 390, height: 844 },
          show: async (p) => {
            await p.setContent(
              `<style>body{font:20px system-ui;padding:30px;background:#eef3e9}</style><h1>${title}</h1><p>This is project-owned synthetic setup.</p><button>Continue</button>`,
            );
          },
        },
        {
          id: "next",
          title: "Next step",
          viewport: { width: 390, height: 844 },
          show: async (p) => {
            await p.setContent(
              `<h1>${title}: next step</h1><p>A different project, same capture contract.</p>`,
            );
          },
        },
      ],
    });
    console.log(
      `${project}: ${manifest.coverage}, ${manifest.steps.length} captures`,
    );
    await page.close();
  }
} finally {
  await browser.close();
}
