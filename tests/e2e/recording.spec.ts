import { test, expect, type Page } from "@playwright/test";
import sharp from "sharp";
import { BASE, asMember, joinAndOpenStep, sharedJourney } from "./members.js";

/** Records for about three seconds, clicking the image at each fraction given. */
async function record(page: Page, clicks: [number, number][]) {
  await expect(
    page.getByText("Recordings here go to the shared project."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Record note" }).click();
  await expect(page.getByText(/Recording ·/)).toBeVisible();
  const img = page.locator(".annotated img");
  await img.scrollIntoViewIfNeeded();
  const box = (await img.boundingBox())!;
  for (const [x, y] of clicks) {
    await page.waitForTimeout(800);
    await page.mouse.move(
      box.x + box.width * (x - 0.05),
      box.y + box.height * y,
    );
    await page.mouse.click(box.x + box.width * x, box.y + box.height * y);
  }
  await page.waitForTimeout(3000 - clicks.length * 800);
  await page.getByRole("button", { name: "Stop" }).click();
}

test("recording 3 seconds of voice with two clicks uploads one audio note with two pins on the image", async ({
  page,
}) => {
  const { owner, journey } = await sharedJourney("Recorded on a version");
  const alex = await joinAndOpenStep(page, owner, journey, "Alex", true);
  await record(page, [
    [0.25, 0.25],
    [0.75, 0.6],
  ]);
  // The preview shows the pins on a timeline before anything is sent.
  await expect(
    page.getByRole("button", { name: /^Comment 1 at / }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^Comment 2 at / }),
  ).toBeVisible();
  await expect(page.locator("audio")).toBeVisible();
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await expect(page.getByText("Waiting for Alex's Loop").first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Video note comment 2 point" }),
  ).toBeVisible();

  const { body } = await asMember(alex.token, `/journeys/${journey}/notes`);
  expect(body.notes).toHaveLength(1);
  const note = body.notes[0];
  expect(note.medium).toBe("audio");
  expect(note.recorderName).toBe("Alex");
  expect(note.pins).toHaveLength(2);
  for (const p of note.pins) {
    expect(p.anchor.kind).toBe("point");
    for (const v of [p.anchor.x, p.anchor.y]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  }
  const [first, second] = note.pins;
  expect(first.anchor.x).toBeCloseTo(0.25, 1);
  expect(first.anchor.y).toBeCloseTo(0.25, 1);
  expect(second.anchor.x).toBeCloseTo(0.75, 1);
  expect(second.anchor.y).toBeCloseTo(0.6, 1);
  expect(second.atMs).toBeGreaterThan(first.atMs);
  expect(note.files.map((f: any) => f.name)).toContain("pointer");
  const media = await fetch(
    `${BASE}/api/journeys/${journey}/media/${note.mediaId}`,
    { headers: { Authorization: `Bearer ${alex.token}` } },
  );
  expect(media.status).toBe(200);
  expect(media.headers.get("content-type")).toMatch(/^audio\//);
});

test("Discard uploads nothing", async ({ page }) => {
  const { owner, journey } = await sharedJourney("Discarded recording");
  const alex = await joinAndOpenStep(page, owner, journey, "Alex", true);
  const sent: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET") sent.push(`${r.method()} ${r.url()}`);
  });
  await record(page, [[0.5, 0.5]]);
  await expect(
    page.getByRole("button", { name: /^Comment 1 at / }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Discard" }).click();
  await expect(page.getByRole("button", { name: "Record note" })).toBeVisible();
  expect(sent.filter((s) => /\/media|\/notes/.test(s))).toEqual([]);
  const { body } = await asMember(alex.token, `/journeys/${journey}/notes`);
  expect(body.notes).toHaveLength(0);
});

test("a member with no linked Loop sees no Record control", async ({
  page,
}) => {
  const { owner, journey } = await sharedJourney("Not linked yet");
  await joinAndOpenStep(page, owner, journey, "Sam", false);
  await expect(page.getByText("Link Loop to record notes here")).toBeVisible();
  await expect(page.getByRole("button", { name: "Record note" })).toHaveCount(
    0,
  );
});

test("on a confidential link the Record control is absent", async ({
  page,
}) => {
  const { owner, journey } = await sharedJourney("Confidential seed");
  await owner.request(`/journeys/${journey}/link/confidential`, {
    confidential: true,
  });
  await joinAndOpenStep(page, owner, journey, "Alex", true);
  await expect(page.getByRole("button", { name: "Record note" })).toHaveCount(
    0,
  );
  await expect(
    page.getByText("Recordings here go to the shared project."),
  ).toHaveCount(0);
});

test("a new version arriving while recording keeps the take on the version it was recorded on", async ({
  page,
}) => {
  const { owner, journey, versionId } = await sharedJourney(
    "New version mid-take",
  );
  const alex = await joinAndOpenStep(page, owner, journey, "Alex", true);
  await page.getByRole("button", { name: "Record note" }).click();
  await expect(page.getByText(/Recording ·/)).toBeVisible();
  const img = page.locator(".annotated img");
  const box = (await img.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const png = await sharp({
    create: { width: 600, height: 400, channels: 3, background: "#cad7e2" },
  })
    .png()
    .toBuffer();
  await owner.request(`/journeys/${journey}/versions`, {
    manifest: {
      schemaVersion: 1,
      parentId: versionId,
      steps: [
        {
          id: "home",
          title: "Home",
          kind: "mockup",
          viewport: { width: 600, height: 400 },
          image: "home.png",
        },
      ],
    },
    assets: { "home.png": png.toString("base64") },
    submissionKey: "mid-take-v2",
  });
  // The journey poll runs every 4 seconds.
  await page.waitForTimeout(5000);
  await page.getByRole("button", { name: "Stop" }).click();
  await expect(
    page.getByRole("button", { name: /^Comment 1 at / }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await expect(page.getByText("Waiting for Alex's Loop").first()).toBeVisible();
  const { body } = await asMember(alex.token, `/journeys/${journey}/notes`);
  expect(body.notes).toHaveLength(1);
  expect(body.notes[0].versionId).toBe(versionId);
});

test("leaving the screen while the microphone is being opened leaves it closed", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const real = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    navigator.mediaDevices.getUserMedia = async (c) => {
      const s = await real(c);
      (window as any).__mic = s;
      await new Promise((r) => setTimeout(r, 1500));
      return s;
    };
  });
  const { owner, journey } = await sharedJourney("Leave while starting");
  await joinAndOpenStep(page, owner, journey, "Alex", true);
  await page.getByRole("button", { name: "Record note" }).click();
  await page.getByRole("button", { name: "Rounds" }).click();
  await page.waitForTimeout(2500);
  expect(
    await page.evaluate(() =>
      (window as any).__mic
        .getTracks()
        .every((t: MediaStreamTrack) => t.readyState === "ended"),
    ),
  ).toBe(true);
});
