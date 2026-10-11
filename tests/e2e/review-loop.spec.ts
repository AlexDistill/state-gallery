import { Client } from "../../src/cli/client.js";
import { test, expect } from "@playwright/test";
import { mkdir, writeFile, readFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import sharp from "sharp";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { captureJourney } from "../../src/capture/playwright.js";
const exec = promisify(execFile);
const evidence = resolve(".evidence");
test("browser authoring, two reviewers, CLI revision, comparison, owner approval and revocation", async ({
  page,
  browser,
}) => {
  await mkdir(evidence, { recursive: true });
  const image = await sharp({
    create: { width: 390, height: 720, channels: 3, background: "#d7e2ca" },
  })
    .png()
    .toBuffer();
  await page.goto("/");
  await page.getByLabel("Installation secret").fill("e2e-local-secret");
  await page.getByRole("button", { name: "Open studio" }).click();
  await page.getByLabel("New journey title").fill("A complete review journey");
  await page.getByRole("button", { name: "Create journey" }).click();
  for (let i = 0; i < 3; i++) {
    await page.getByRole("button", { name: "+ Add step" }).click();
    await page
      .getByLabel("Stable step ID")
      .nth(i)
      .fill(["discover", "choose", "checkout"][i]);
    await page
      .getByLabel("Screen title")
      .nth(i)
      .fill(["Discover", "Choose", "Checkout"][i]);
    await page
      .getByLabel("Purpose", { exact: true })
      .nth(i)
      .fill("Help someone find their next step.");
    await page
      .getByLabel("Transition to next step")
      .nth(i)
      .fill("Continue with confidence");
    if (i === 2)
      await page.getByLabel("Visual type").nth(i).selectOption("capture");
    await page.getByLabel(`Image for step ${i + 1}`).setInputFiles({
      name: `${i}.png`,
      mimeType: "image/png",
      buffer: image,
    });
  }
  await page
    .getByRole("button", { name: "Move up", exact: true })
    .nth(2)
    .click();
  await page
    .getByRole("button", { name: "Submit version", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Open Checkout" }),
  ).toBeVisible();
  await page.screenshot({
    path: join(evidence, "overview-desktop.png"),
    fullPage: true,
    mask: [page.locator(".secret")],
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: join(evidence, "overview-mobile.png"),
    fullPage: true,
    mask: [page.locator(".secret")],
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByRole("button", { name: "Create reviewer link", exact: true })
    .click();
  const link = await page
    .getByLabel("Review link", { exact: true })
    .inputValue();
  const first = await browser.newContext({
      viewport: { width: 390, height: 844 },
    }),
    second = await browser.newContext();
  const p1 = await first.newPage(),
    p2 = await second.newPage();
  for (const [p, name] of [
    [p1, "Maya"],
    [p2, "Julio"],
  ] as const) {
    await p.goto(link);
    await p.getByLabel("Your display name").fill(name);
    await p.getByRole("button", { name: "Join review" }).click();
    await p.getByRole("button", { name: "Open Checkout" }).click();
  }
  await p1.getByRole("button", { name: "Mark a region", exact: true }).click();
  const box = await p1.locator(".annotated").boundingBox();
  await p1.mouse.move(box!.x + box!.width * 0.1, box!.y + box!.height * 0.2);
  await p1.mouse.down();
  await p1.mouse.move(box!.x + box!.width * 0.5, box!.y + box!.height * 0.4);
  await p1.mouse.up();
  await p1
    .getByLabel("New comment", { exact: true })
    .fill("Bring the next step closer to the button.");
  await p1.getByRole("button", { name: "Save comment", exact: true }).click();
  await expect(p1.getByLabel("Comment 1 region")).toBeVisible();
  await p1.reload();
  await p1.getByRole("button", { name: "Open Checkout" }).click();
  await expect(p1.getByLabel("Comment 1 region")).toBeVisible();
  await p2
    .getByLabel("New comment", { exact: true })
    .fill("Add a delivery estimate.");
  await p2.getByRole("button", { name: "Save comment", exact: true }).click();
  await p1
    .getByLabel("Reply to comment 1")
    .fill("Near the main action, please.");
  await p1.getByRole("button", { name: "Reply", exact: true }).first().click();
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.getByRole("button", { name: "Open Checkout" }).click();
  await expect(
    page.getByText("Add a delivery estimate.", { exact: true }).first(),
  ).toBeVisible();
  await page.screenshot({
    path: join(evidence, "annotations-desktop.png"),
    fullPage: true,
    mask: [page.locator(".secret")],
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: join(evidence, "annotations-mobile.png"),
    fullPage: true,
    mask: [page.locator(".secret")],
  });
  const anchorBefore = await p1
    .locator(".marker.region")
    .first()
    .evaluate((e: HTMLElement) => ({
      left: e.style.left,
      width: e.style.width,
    }));
  await p1.setViewportSize({ width: 1000, height: 900 });
  const anchorAfter = await p1
    .locator(".marker.region")
    .first()
    .evaluate((e: HTMLElement) => ({
      left: e.style.left,
      width: e.style.width,
    }));
  expect(anchorAfter).toEqual(anchorBefore);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByRole("button", { name: "Request revision", exact: true })
    .click();
  await expect(
    page.getByText("Latest revision request", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: join(evidence, "request-desktop.png"),
    fullPage: true,
    mask: [page.locator(".secret")],
  });
  const request = await page.locator(".request-card code").innerText();
  await page
    .getByRole("button", { name: "Create agent credential", exact: true })
    .click();
  const token = await page.getByLabel("Agent token — shown once").inputValue();
  const journeys = await page.evaluate(async () =>
    (await fetch("/api/journeys")).json(),
  );
  const j = journeys.find((j: any) => j.title === "A complete review journey");
  const directory = await mkdtemp(join(tmpdir(), "sg-revision-"));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    STATE_GALLERY_URL: "http://localhost:4201",
    STATE_GALLERY_TOKEN: token,
  };
  delete env.STATE_GALLERY_OWNER_SECRET;
  await exec(
    process.execPath,
    ["dist/cli/index.js", "export", j.id, request, directory],
    { env },
  );
  const feedback = JSON.parse(
    await readFile(join(directory, "feedback.json"), "utf8"),
  );
  expect(feedback.comments.length).toBe(2);
  const manifest = JSON.parse(
    await readFile(join(directory, "manifest.json"), "utf8"),
  );
  expect(
    (await readFile(join(directory, manifest.steps[0].image))).length,
  ).toBeGreaterThan(100);
  manifest.steps.find((s: any) => s.id === "checkout").title =
    "Checkout, clarified";
  manifest.responses = Object.fromEntries(
    feedback.comments.map((c: any) => [
      c.id,
      "Clarified the next step and estimate.",
    ]),
  );
  await writeFile(join(directory, "manifest.json"), JSON.stringify(manifest));
  const firstSubmit = await exec(
    process.execPath,
    [
      "dist/cli/index.js",
      "submit",
      j.id,
      join(directory, "manifest.json"),
      "revision-1",
    ],
    { env },
  );
  const retry = await exec(
    process.execPath,
    [
      "dist/cli/index.js",
      "submit",
      j.id,
      join(directory, "manifest.json"),
      "revision-1",
    ],
    { env },
  );
  expect(retry.stdout).toBe(firstSubmit.stdout);
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page
    .getByLabel("Version", { exact: true })
    .selectOption({ label: "Version 2 · current" });
  await expect(
    page.getByText("Revision response", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Open Checkout, clarified", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Compare with previous", exact: true })
    .click();
  await page.screenshot({
    path: join(evidence, "comparison-desktop.png"),
    fullPage: true,
    mask: [page.locator(".secret")],
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: join(evidence, "comparison-mobile.png"),
    fullPage: true,
    mask: [page.locator(".secret")],
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByRole("button", { name: "Approve for build", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Resolve all");
  await page.getByRole("button", { name: "Dismiss", exact: true }).click();
  while (
    await page.getByRole("button", { name: "Resolve", exact: true }).count()
  ) {
    const before = await page
      .getByRole("button", { name: "Resolve", exact: true })
      .count();
    await page
      .getByRole("button", { name: "Resolve", exact: true })
      .first()
      .click();
    await expect(
      page.getByRole("button", { name: "Resolve", exact: true }),
    ).toHaveCount(before - 1);
  }
  await page
    .getByRole("button", { name: "Approve for build", exact: true })
    .click();
  await expect(page.locator(".approval")).toBeVisible();
  const brief = await exec(
    process.execPath,
    ["dist/cli/index.js", "build-brief", j.id],
    { env },
  );
  expect(JSON.parse(brief.stdout).authorized).toBe(true);
  await page.screenshot({
    path: join(evidence, "approved-desktop.png"),
    fullPage: true,
    mask: [page.locator(".secret")],
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: join(evidence, "approved-mobile.png"),
    fullPage: true,
    mask: [page.locator(".secret")],
  });
  await page
    .getByRole("button", { name: "Revoke", exact: true })
    .first()
    .click();
  await p1
    .getByRole("button", { name: "Save comment", exact: true })
    .click()
    .catch(() => {});
  await p1
    .getByLabel("New comment", { exact: true })
    .fill("Can I still comment?");
  await p1.getByRole("button", { name: "Save comment", exact: true }).click();
  await expect(p1.getByRole("alert")).toContainText("expired or revoked");
  await p1.screenshot({
    path: join(evidence, "access-failure-mobile.png"),
    fullPage: true,
  });
  await p1.setViewportSize({ width: 1440, height: 1000 });
  await p1.screenshot({
    path: join(evidence, "access-failure-desktop.png"),
    fullPage: true,
  });
  await first.close();
  await second.close();
});
test("portable capture records expected inventory, failures and selections from caller-owned pages", async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "sg-capture-"));
  const m = await captureJourney(page, {
    title: "Synthetic capture",
    directory,
    steps: [
      {
        id: "landing",
        title: "Landing",
        viewport: { width: 390, height: 844 },
        show: async (p) => {
          await p.setContent("<h1>Synthetic landing</h1>");
        },
      },
      {
        id: "failed",
        title: "Failed screen",
        viewport: { width: 390, height: 844 },
        show: async () => {
          throw new Error("Expected setup failure");
        },
      },
      {
        id: "unselected",
        title: "Later",
        viewport: { width: 390, height: 844 },
        show: async () => {
          throw new Error("Must not run");
        },
      },
    ],
    selected: ["landing", "failed"],
  });
  expect(m.coverage).toBe("partial");
  expect(m.expected).toHaveLength(3);
  expect(m.steps.map((s) => s.outcome)).toEqual([
    "captured",
    "failed",
    "missing",
  ]);
  expect(
    (await readFile(join(directory, "landing.png"))).length,
  ).toBeGreaterThan(100);
  const client = new Client(
    "http://localhost:4201",
    undefined,
    "e2e-local-secret",
  );
  const j = await client.request("/journeys", {
    title: "Caller-owned capture import",
  });
  await exec(
    process.execPath,
    [
      "dist/cli/index.js",
      "import",
      j.id,
      join(directory, "manifest.json"),
      "capture-import",
    ],
    {
      env: {
        ...process.env,
        STATE_GALLERY_URL: "http://localhost:4201",
        STATE_GALLERY_OWNER_SECRET: "e2e-local-secret",
        STATE_GALLERY_TOKEN: "",
      },
    },
  );
  await page.goto("/");
  await page.getByLabel("Installation secret").fill("e2e-local-secret");
  await page.getByRole("button", { name: "Open studio" }).click();
  await page
    .getByRole("button", { name: /Caller-owned capture import/ })
    .click();
  await expect(
    page.getByRole("button", { name: "Open Landing" }),
  ).toBeVisible();
  await expect(
    page.locator(".gap").filter({ hasText: "Capture failed" }),
  ).toBeVisible();
  await expect(
    page.getByText("Not selected in this capture run", { exact: true }),
  ).toBeVisible();
});
test("failed upload retains draft; unchanged images carry forward; stale drafts require an explicit reload", async ({
  page,
}) => {
  const bytes = await sharp({
    create: { width: 200, height: 100, channels: 3, background: "#abc" },
  })
    .png()
    .toBuffer();
  await page.goto("/");
  await page.getByLabel("Installation secret").fill("e2e-local-secret");
  await page.getByRole("button", { name: "Open studio" }).click();
  await page.getByLabel("New journey title").fill("Draft recovery");
  await page.getByRole("button", { name: "Create journey" }).click();
  await page.getByRole("button", { name: "+ Add step" }).click();
  await page.getByLabel("Stable step ID").fill("one");
  await page.getByLabel("Screen title").fill("Kept draft title");
  await page.getByLabel("Image for step 1").setInputFiles({
    name: "bad.png",
    mimeType: "image/png",
    buffer: Buffer.from("not a raster"),
  });
  await page
    .getByRole("button", { name: "Submit version", exact: true })
    .click();
  await expect(page.getByLabel("Screen title")).toHaveValue("Kept draft title");
  await expect(page.getByRole("alert").first()).toContainText(
    "valid single PNG",
  );
  await page.getByRole("button", { name: "Dismiss", exact: true }).click();
  await page
    .getByLabel("Image for step 1")
    .setInputFiles({ name: "one.png", mimeType: "image/png", buffer: bytes });
  await page
    .getByRole("button", { name: "Submit version", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Open Kept draft title" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add version", exact: true }).click();
  await page.getByLabel("Screen title").fill("Renamed screen");
  await page
    .getByRole("button", { name: "Submit version", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Open Renamed screen" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add version", exact: true }).click();
  await page.getByLabel("Screen title").fill("An older draft");
  const journeys = await page.evaluate(async () =>
    (await fetch("/api/journeys")).json(),
  );
  const j = journeys.find((j: any) => j.title === "Draft recovery");
  const next = await page.request.post(`/api/journeys/${j.id}/versions`, {
    headers: { Origin: "http://localhost:4201" },
    data: {
      manifest: {
        schemaVersion: 1,
        parentId: j.currentId,
        steps: [
          {
            id: "one",
            title: "Concurrent version",
            kind: "capture",
            viewport: { width: 200, height: 100 },
            image: "one.png",
          },
        ],
      },
      assets: { "one.png": bytes.toString("base64") },
      submissionKey: "concurrent",
    },
  });
  expect(next.status()).toBe(201);
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page
    .getByRole("button", { name: "Submit version", exact: true })
    .click();
  await expect(page.getByRole("alert").first()).toContainText(
    "Parent is stale",
  );
  await expect(page.getByLabel("Screen title")).toHaveValue("An older draft");
});
