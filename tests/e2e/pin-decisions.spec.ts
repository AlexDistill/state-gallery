import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import {
  BASE,
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
  const up = await fetch(`${BASE}/api/journeys/${journey}/media`, {
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
  return { owner, journey, alex, pins };
}

test("approving, editing and dropping three pins shows three decisions with the member's name", async ({
  page,
}) => {
  const { owner, journey, pins } = await processedNote("Three decisions");
  const amadeo = await joinAndOpenStep(page, owner, journey, "Amadeo", false);
  await expect(page.getByText("Three points on the home screen")).toBeVisible();

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
  await expect(page.getByText(/Latest request: 2 decided pins/)).toBeVisible();
  await page.getByRole("button", { name: /Enlarge the title/ }).click();
  await expect(
    page.getByText("In a revision request; this pin can't be decided again."),
  ).toBeVisible();

  await page.getByRole("button", { name: "Turns", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Turns · 0" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Shelf · 0" })).toBeVisible();
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
  await page.getByRole("button", { name: /Enlarge the title/ }).click();
  await expect(page.getByRole("button", { name: "Drop" })).toBeVisible();

  const first = await asMember(
    alex.token,
    `/journeys/${journey}/pins/${pins[0].id}/decisions`,
    { expected: null, status: "approved" },
  );
  expect(first.status).toBe(201);

  await page.getByRole("button", { name: "Drop" }).click();
  await expect(page.getByRole("alert")).toContainText(
    /Alex already approved this at \d/,
  );
  await expect(page.getByText("Approved by Alex")).toBeVisible();
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
