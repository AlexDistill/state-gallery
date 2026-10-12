import type { Page } from "playwright-core";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { manifestSchema, type Manifest } from "../shared/schema.js";
export interface CaptureStep {
  id: string;
  title: string;
  purpose?: string;
  transition?: string;
  viewport: { width: number; height: number };
  show: (page: Page) => Promise<void>;
  check?: (page: Page) => Promise<void>;
  fullPage?: boolean;
}
export interface CaptureAttachments {
  attach(
    name: string,
    options: { body: Buffer; contentType: string },
  ): Promise<void>;
}
export async function captureJourney(
  page: Page,
  options: {
    title: string;
    directory: string;
    steps: CaptureStep[];
    selected?: string[];
    testInfo?: CaptureAttachments;
  },
): Promise<Manifest> {
  const expected = options.steps.map((s) => s.id);
  if (new Set(expected).size !== expected.length)
    throw new Error("Duplicate capture step IDs");
  if (options.selected?.some((id) => !expected.includes(id)))
    throw new Error("Selected step is outside expected inventory");
  await mkdir(options.directory, { recursive: true });
  const steps = [];
  for (const s of options.steps) {
    if (options.selected && !options.selected.includes(s.id)) {
      steps.push({
        ...s,
        show: undefined,
        check: undefined,
        kind: "gap",
        outcome: "missing",
        provenance: "Not selected in this capture run",
      });
      continue;
    }
    if (!/^[\w.-]{1,100}$/.test(s.id))
      throw new Error("Unsafe capture step ID");
    try {
      await page.setViewportSize(s.viewport);
      await s.show(page);
      await page.evaluate(() => document.fonts.ready.then(() => {}));
      await s.check?.(page);
      const image = `${s.id}.png`;
      const bytes = await page.screenshot({
        animations: "disabled",
        fullPage: s.fullPage ?? false,
      });
      await writeFile(join(options.directory, image), bytes);
      await options.testInfo?.attach(`journey:${s.id}`, {
        body: bytes,
        contentType: "image/png",
      });
      steps.push({
        ...s,
        show: undefined,
        check: undefined,
        image,
        kind: "capture",
        outcome: "captured",
        provenance: `Playwright ${new Date().toISOString()}; ${s.fullPage ? "full page" : "viewport"}`,
      });
    } catch (e) {
      steps.push({
        ...s,
        show: undefined,
        check: undefined,
        kind: "gap",
        outcome: "failed",
        provenance: `Capture failed: ${(e as Error).message}`,
      });
    }
  }
  const manifest = manifestSchema.parse({
    schemaVersion: 1,
    title: options.title,
    expected,
    coverage: steps.every((s) => s.outcome === "captured")
      ? "complete"
      : "partial",
    steps,
  });
  await writeFile(
    join(options.directory, "manifest.json"),
    JSON.stringify(manifest, null, 2),
  );
  return manifest;
}
