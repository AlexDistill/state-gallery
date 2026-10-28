import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import sharp from "sharp";
import {
  base,
  asMember,
  joinAndOpenStep,
  member,
  sharedJourney,
} from "./members.js";

const PROPOSALS = [
  "Enlarge the title",
  "Make the button green",
  "Remove the border",
];

/** Alex's Loop pushes a processed note with three proposed changes. */
async function processedNote(title: string) {
  const { owner, journey, versionId } = await sharedJourney(title);
  const alex = await member(owner, journey, "Alex", true);
  const up = await fetch(`${base()}/api/journeys/${journey}/media`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${alex.token}`,
      "Content-Type": "audio/mp4",
    },
    body: new Uint8Array(randomBytes(4096)),
  });
  const { id: mediaId } = (await up.json()) as { id: string };
  const pins = PROPOSALS.map((_, i) => ({
    id: `${title.replace(/\W/g, "")}-pin-${i + 1}`,
    anchor: { kind: "point", x: 0.2 + i * 0.3, y: 0.5 },
    atMs: 1000 + i * 4000,
  }));
  const pushed = await asMember(alex.token, `/journeys/${journey}/sync/push`, {
    link: { seedId: "seed-Alex", bed: "shared:team", confidential: false },
    notes: [
      {
        eventId: `${pins[0].id}-note`,
        versionId,
        stepId: "home",
        medium: "audio",
        pins,
        files: [{ name: "audio", mediaId }],
        processing: {
          transcript: "the title, the button and that border",
          summary: "Three points on the home screen",
          proposals: pins.map((p, i) => ({
            pinId: p.id,
            quote: `about ${PROPOSALS[i].toLowerCase()}`,
            proposal: PROPOSALS[i],
          })),
        },
      },
    ],
  });
  expect(pushed.status).toBe(200);
  return { owner, journey, versionId, alex, pins, mediaId };
}

test("approving, editing and dropping three pins shows three decisions with the member's name", async ({
  page,
}) => {
  const { owner, journey, pins, mediaId } =
    await processedNote("Three decisions");
  const amadeo = await joinAndOpenStep(page, owner, journey, "Amadeo", false);
  await expect(page.getByText("Three points on the home screen")).toBeVisible();

  // Another member can play the processed note back.
  const player = page.getByLabel("Play Alex's voice note");
  await expect(player).toBeVisible();
  const src = await player.getAttribute("src");
  expect(src).toBe(`/api/journeys/${journey}/media/${mediaId}`);
  expect((await page.request.get(src!)).status()).toBe(200);
  // Nothing decided yet, so there is nothing to request.
  await expect(
    page.getByRole("button", { name: "Request revision" }),
  ).toBeDisabled();

  // What I heard comes first; the per-comment rows wait behind Change it.
  const heard = page.getByLabel("What I heard");
  await expect(heard.locator(".heard-title")).toHaveText(PROPOSALS);
  await expect(page.locator(".pin-row")).toHaveCount(0);
  await heard.getByRole("button", { name: "Change it" }).click();
  await page.getByRole("button", { name: /Enlarge the title/ }).click();
  await expect(page.getByText("“about enlarge the title”")).toBeVisible();
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Approved by Amadeo")).toBeVisible();

  await page.getByRole("button", { name: /Make the button green/ }).click();
  await page.getByRole("button", { name: "Change", exact: true }).click();
  await page.getByLabel("Changed text").fill("Make the button teal");
  await page.getByRole("button", { name: "Save change" }).click();
  await expect(page.getByText("Changed by Amadeo")).toBeVisible();
  await expect(
    page.locator(".decision").getByText("Make the button teal"),
  ).toBeVisible();
  // The row shows the changed text, not the proposal.
  await expect(page.locator(".pin-title").nth(1)).toHaveText(
    "Make the button teal",
  );

  await page.getByRole("button", { name: /Remove the border/ }).click();
  await page.getByRole("button", { name: "Drop" }).click();
  await expect(page.getByText("Dropped by Amadeo")).toBeVisible();
  await expect(
    page.getByRole("list", { name: "Decision history" }),
  ).toContainText("Dropped · Amadeo");

  await expect(page.locator(".pin-status")).toHaveText([
    "Approved",
    "Changed",
    "Dropped",
  ]);
  await expect(page.getByText("In revision request")).toHaveCount(0);
  const { body } = await asMember(amadeo.token, `/journeys/${journey}/notes`);
  expect(
    body.notes[0].pins.map((p: any) => [
      p.id,
      p.decision.status,
      p.decision.memberName,
      p.decision.text,
    ]),
  ).toEqual([
    [pins[0].id, "approved", "Amadeo", "Enlarge the title"],
    [pins[1].id, "changed", "Amadeo", "Make the button teal"],
    [pins[2].id, "dropped", "Amadeo", null],
  ]);

  // A member requests the revision: decided pins go in, the dropped one resolves.
  await page.getByRole("button", { name: "Request revision" }).click();
  await expect(
    page.getByText(/Latest request: 2 decided comments/),
  ).toBeVisible();
  // Every row is now in the request, and there is nothing new to send.
  await expect(page.locator(".pin-request")).toHaveText([
    "In revision request",
    "In revision request",
    "In revision request",
  ]);
  await expect(
    page.getByRole("button", { name: "Request revision" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: /Enlarge the title/ }).click();
  await expect(
    page.getByText(
      "In a revision request; this comment can't be decided again.",
    ),
  ).toBeVisible();

  await page.getByRole("button", { name: "Rounds", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Rounds · 0" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Later · 0" })).toBeVisible();
});

test("a stale decision shows the existing one and changes nothing", async ({
  page,
}) => {
  const { owner, journey, alex, pins } = await processedNote("Stale decision");
  // Amadeo's screen keeps the notes as they were when it opened.
  let stale: unknown = null;
  await page.route(/\/api\/journeys\/[^/]+\/notes(\?.*)?$/, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    if (!stale) stale = await (await route.fetch()).json();
    await route.fulfill({ json: stale });
  });
  const amadeo = await joinAndOpenStep(page, owner, journey, "Amadeo", false);
  await page.getByRole("button", { name: "Change it" }).click();
  await page.getByRole("button", { name: /Enlarge the title/ }).click();
  await expect(page.getByRole("button", { name: "Drop" })).toBeVisible();

  const first = await asMember(
    alex.token,
    `/journeys/${journey}/pins/${pins[0].id}/decisions`,
    { expected: null, status: "approved" },
  );
  expect(first.status).toBe(201);

  await page.getByRole("button", { name: "Drop" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Alex already decided this change. Their decision stands; yours is kept in the history.",
  );
  await expect(page.getByText("Approved by Alex")).toBeVisible();
  await expect(page.locator(".decision .nowrap")).toHaveText(/^\d{1,2}:\d{2}/);
  // The comment is decided: no more Approve / Change / Drop here.
  for (const name of ["Approve", "Change", "Drop"])
    await expect(page.getByRole("button", { name, exact: true })).toHaveCount(
      0,
    );
  await expect(
    page.getByRole("list", { name: "Decision history" }),
  ).toContainText("Dropped · Amadeo");

  const { body } = await asMember(
    amadeo.token,
    `/journeys/${journey}/pins/${pins[0].id}/history`,
  );
  expect(
    body.decisions.map((d: any) => [d.status, d.memberName, d.refused]),
  ).toEqual([
    ["approved", "Alex", false],
    ["dropped", "Amadeo", true],
  ]);
  const notes = await asMember(alex.token, `/journeys/${journey}/notes`);
  expect(notes.body.notes[0].pins[0].decision).toMatchObject({
    id: first.body.decision.id,
    status: "approved",
  });
});

test("Yes, do it approves every open comment and leaves a decided one as it is", async ({
  page,
}) => {
  const { owner, journey, alex, pins } = await processedNote("Yes do it");
  // Alex drops the third comment before anyone opens the note.
  const dropped = await asMember(
    alex.token,
    `/journeys/${journey}/pins/${pins[2].id}/decisions`,
    { expected: null, status: "dropped" },
  );
  expect(dropped.status).toBe(201);
  const amadeo = await joinAndOpenStep(page, owner, journey, "Amadeo", false);
  await expect(
    page.getByRole("heading", { name: "Comments · 1" }),
  ).toBeVisible();
  const heard = page.getByLabel("What I heard");
  await expect(heard).toContainText("Three points on the home screen");
  await expect(heard.locator(".heard-title")).toHaveText(PROPOSALS);
  if (process.env.GALLERY_SCREENSHOT)
    await page
      .locator(".discussion")
      .screenshot({ path: process.env.GALLERY_SCREENSHOT });

  await heard.getByRole("button", { name: "Yes, do it" }).click();
  // Nothing is left open, so the rows show and Yes, do it has nothing more to do.
  await expect(page.locator(".pin-status")).toHaveText([
    "Approved",
    "Approved",
    "Dropped",
  ]);
  await expect(
    heard.getByRole("button", { name: "Yes, do it" }),
  ).toBeDisabled();
  await expect(heard.getByRole("button", { name: "Change it" })).toHaveCount(0);
  await expect(heard.getByRole("status")).toHaveCount(0);

  const { body } = await asMember(amadeo.token, `/journeys/${journey}/notes`);
  expect(
    body.notes[0].pins.map((p: any) => [
      p.decision.status,
      p.decision.memberName,
      p.decision.id === dropped.body.decision.id || null,
    ]),
  ).toEqual([
    ["approved", "Amadeo", null],
    ["approved", "Amadeo", null],
    ["dropped", "Alex", true],
  ]);
});

test("Yes, do it keeps going past a comment someone else decided first", async ({
  page,
}) => {
  const { owner, journey, alex, pins } = await processedNote("Yes do it race");
  // Amadeo's screen keeps the notes as they were when it opened.
  let stale: unknown = null;
  await page.route(/\/api\/journeys\/[^/]+\/notes(\?.*)?$/, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    if (!stale) stale = await (await route.fetch()).json();
    await route.fulfill({ json: stale });
  });
  const amadeo = await joinAndOpenStep(page, owner, journey, "Amadeo", false);
  await expect(page.getByLabel("What I heard")).toBeVisible();
  const changed = await asMember(
    alex.token,
    `/journeys/${journey}/pins/${pins[1].id}/decisions`,
    { expected: null, status: "changed", text: "Make the button teal" },
  );
  expect(changed.status).toBe(201);

  await page.getByRole("button", { name: "Yes, do it" }).click();
  await expect(page.getByLabel("What I heard").getByRole("status")).toHaveText(
    "Someone else had already decided 1 comment, so it was left as it is.",
  );
  const { body } = await asMember(amadeo.token, `/journeys/${journey}/notes`);
  expect(
    body.notes[0].pins.map((p: any) => [
      p.decision.status,
      p.decision.memberName,
    ]),
  ).toEqual([
    ["approved", "Amadeo"],
    ["changed", "Alex"],
    ["approved", "Amadeo"],
  ]);
});

test("a round that became a version lists what came out, and Later shows readable titles", async ({
  page,
}) => {
  const { owner, journey, versionId, alex } =
    await processedNote("Rounds and later");
  const png = await sharp({
    create: { width: 600, height: 400, channels: 3, background: "#c9b79c" },
  })
    .png()
    .toBuffer();
  const up = await fetch(`${base()}/api/journeys/${journey}/media`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${alex.token}`,
      "Content-Type": "image/png",
    },
    body: new Uint8Array(png),
  });
  const { id: image } = (await up.json()) as { id: string };
  const pushed = await asMember(alex.token, `/journeys/${journey}/sync/push`, {
    link: { seedId: "seed-Alex", bed: "shared:team", confidential: false },
    turns: [
      {
        eventId: "rounds-turn-1",
        loopTurnId: "rounds-turn-1",
        parentIds: [],
        inputs: [{ title: "The brief" }],
        outputs: [{ title: "Home, revised", kind: "image" }],
        reactionNoteIds: [],
        parentVersionId: versionId,
        version: {
          steps: [
            {
              id: "home",
              title: "Home",
              kind: "mockup",
              viewport: { width: 600, height: 400 },
              image,
            },
          ],
        },
      },
    ],
    shelf: [
      {
        eventId: "rounds-shelf-1",
        itemId: "testimonials-strip",
        reason: "Wait for real quotes",
      },
      { eventId: "rounds-shelf-2", itemId: "home", reason: "Maybe later" },
    ],
  });
  expect(pushed.status).toBe(200);
  await joinAndOpenStep(page, owner, journey, "Amadeo", false);
  await page.getByRole("button", { name: "Rounds", exact: true }).click();
  const round = page.locator(".turn").first();
  await expect(round).toContainText("Became version 2 · 1 image as steps");
  await expect(round.locator(".turn-output")).toHaveText(["Home, revised"]);
  const later = page.locator(".shelf-item strong");
  // Both arrive in one push with the same time, so their order is not asserted.
  await expect(later).toHaveCount(2);
  expect((await later.allTextContents()).sort()).toEqual([
    "Home",
    "Testimonials strip",
  ]);
  await expect(page.getByText("Wait for real quotes")).toBeVisible();
});
