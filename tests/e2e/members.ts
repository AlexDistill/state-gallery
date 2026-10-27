import { expect, type Page } from "@playwright/test";
import sharp from "sharp";
import { Client } from "../../src/cli/client.js";

export const BASE = "http://localhost:4202";

// One owner login for the whole run: sign-in routes allow 15 attempts a minute per address.
const owner = new Client(BASE, undefined, "e2e-local-secret");

/** A journey with one version of one 600 × 400 step, created by the owner. */
export async function sharedJourney(title: string) {
  const j = await owner.request("/journeys", { title });
  const png = await sharp({
    create: { width: 600, height: 400, channels: 3, background: "#d7e2ca" },
  })
    .png()
    .toBuffer();
  const version = await owner.request(`/journeys/${j.id}/versions`, {
    manifest: {
      schemaVersion: 1,
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
    submissionKey: `${title}-v1`,
  });
  return { owner, journey: j.id as string, versionId: version.id as string };
}

/** Calls the API with a member token, the way Loop does. */
export async function asMember(
  token: string,
  path: string,
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
) {
  const r = await fetch(`${BASE}/api${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  return {
    status: r.status,
    headers: r.headers,
    body:
      text && r.headers.get("content-type")?.includes("json")
        ? JSON.parse(text)
        : text,
  };
}

const linkLoop = async (token: string, journey: string, name: string) =>
  expect(
    (
      await asMember(token, `/journeys/${journey}/link`, {
        seedId: `seed-${name}`,
        bed: "shared:team",
        confidential: false,
      })
    ).status,
  ).toBe(200);

/** Invites and redeems a member through the API; `link` also links their Loop. */
export async function member(
  owner: Client,
  journey: string,
  name: string,
  link: boolean,
) {
  const g = await owner.inviteMember(journey, name);
  const r = await fetch(`${BASE}/api/members/redeem`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE },
    body: JSON.stringify({ invite: g.invite }),
  });
  expect(r.status).toBe(200);
  const { memberToken } = (await r.json()) as { memberToken: string };
  if (link) await linkLoop(memberToken, journey, name);
  return { name, token: memberToken };
}

/**
 * Accepts an invite in the browser, optionally links that member's Loop, and opens the
 * journey's first step. Returns the member token the gallery showed once.
 */
export async function joinAndOpenStep(
  page: Page,
  owner: Client,
  journey: string,
  name: string,
  link: boolean,
) {
  const g = await owner.inviteMember(journey, name);
  await page.goto(`/#invite=${g.invite}`);
  await page.getByRole("button", { name: "Accept invite" }).click();
  const token = await page.getByLabel("Member token").inputValue();
  expect(token).toBeTruthy();
  await page.getByRole("button", { name: "I have saved it" }).click();
  if (link) {
    await linkLoop(token, journey, name);
    // The session picks up the linked Loop on the next page load.
    await page.reload();
  }
  await page.getByRole("button", { name: "1. Home" }).click();
  await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();
  return { name, token };
}
