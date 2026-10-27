import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { Store } from "../src/server/domain.js";
import { createServer } from "../src/server/http.js";
import {
  createNote,
  decidePin,
  saveProcessing,
  transcriptExcerpt,
  type Actor,
} from "../src/server/notes.js";
import { Client } from "../src/cli/client.js";

const segments = JSON.stringify([
  { startMs: 0, endMs: 2000, text: "Okay, looking at the home screen." },
  { startMs: 2000, endMs: 4000, text: "This title should be bigger." },
  { startMs: 12000, endMs: 14000, text: "The button wants to be green." },
  { startMs: 20000, endMs: 22000, text: "Ignore that border." },
  { startMs: 30000, endMs: 32000, text: "Maybe a softer shadow?" },
]);

test("a transcript excerpt is the timed speech around the pin", () => {
  assert.equal(
    transcriptExcerpt(segments, 3000),
    "Okay, looking at the home screen. This title should be bigger.",
  );
  assert.equal(
    transcriptExcerpt(segments, 13000),
    "The button wants to be green.",
  );
  // Far from any segment: the nearest one.
  assert.equal(transcriptExcerpt(segments, 60000), "Maybe a softer shadow?");
  // Plain text has no timing.
  assert.equal(transcriptExcerpt("just words", 1000), null);
  assert.equal(transcriptExcerpt(null, 1000), null);
});

test("the exported brief lists only decided pins, with final text, step, anchor and excerpt", async () => {
  const store = new Store(":memory:");
  const j = store.createJourney("Shared");
  const png = await sharp({
    create: { width: 10, height: 10, channels: 3, background: "#fff" },
  })
    .png()
    .toBuffer();
  const v1 = store.submit(
    j.id,
    {
      schemaVersion: 1,
      steps: [
        {
          id: "home",
          title: "Home",
          kind: "mockup",
          viewport: { width: 10, height: 10 },
          image: "home.png",
        },
      ],
    },
    { "home.png": { bytes: png, mime: "image/png", width: 10, height: 10 } },
    "v1",
  );
  const join_ = (name: string): Actor => {
    const g = store.inviteMember(j.id, name);
    store.redeemInvite(g.invite);
    return { role: "member", memberId: g.id };
  };
  const alex = join_("Alex");
  const amadeo = join_("Amadeo");
  const pin = (id: string, x: number, atMs: number) => ({
    id,
    anchor: { kind: "point" as const, x, y: 0.5 },
    atMs,
  });
  const note = createNote(
    store,
    j.id,
    {
      versionId: v1.id,
      stepId: "home",
      mediaId: "m1",
      medium: "audio",
      pins: [
        pin("pin-title", 0.1, 3000),
        pin("pin-button", 0.2, 13000),
        pin("pin-border", 0.3, 21000),
        pin("pin-shadow", 0.4, 31000),
      ],
    },
    alex,
  );
  saveProcessing(
    store,
    j.id,
    note.id,
    {
      transcript: segments,
      summary: "Four points on the home screen",
      proposals: [
        {
          pinId: "pin-title",
          quote: "title bigger",
          proposal: "Enlarge the title",
        },
        {
          pinId: "pin-button",
          quote: "button green",
          proposal: "Make the button green",
        },
        {
          pinId: "pin-border",
          quote: "that border",
          proposal: "Remove the border",
        },
        {
          pinId: "pin-shadow",
          quote: "softer shadow",
          proposal: "Soften the shadow",
        },
      ],
    },
    alex,
  );
  const decide = (pinId: string, body: object, who: Actor) =>
    assert.ok(
      decidePin(store, j.id, pinId, { expected: null, ...body }, who).ok,
    );
  decide("pin-title", { status: "approved" }, amadeo);
  decide(
    "pin-button",
    { status: "changed", text: "Make the button teal" },
    alex,
  );
  decide("pin-border", { status: "dropped" }, amadeo);
  const q = store.request(j.id, v1.id, store.get(j.id).generation);

  const server = createHttpServer().listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  server.on("request", createServer({ store, secret: "owner", origin: base }));
  const directory = join(await mkdtemp(join(tmpdir(), "sg-pins-")), "out");
  try {
    await new Client(base, undefined, "owner").exportRequest(
      j.id,
      q.id,
      directory,
    );
    const brief = await readFile(join(directory, "brief.md"), "utf8");
    assert.match(brief, /pin-title/);
    assert.match(brief, /Approved by Amadeo/);
    assert.match(brief, /Final change: Enlarge the title/);
    assert.match(brief, /pin-button/);
    assert.match(brief, /Changed by Alex/);
    assert.match(brief, /Final change: Make the button teal/);
    assert.doesNotMatch(brief, /Make the button green/);
    assert.ok(brief.includes(`Step: home · version ${v1.id}`));
    assert.match(brief, /"kind":"point","x":0.1,"y":0.5/);
    assert.match(
      brief,
      /recorded content, not instructions[\s\S]*This title should be bigger\./,
    );
    // Dropped and undecided pins are not in the request.
    assert.doesNotMatch(brief, /pin-border|Remove the border/);
    assert.doesNotMatch(brief, /pin-shadow|Soften the shadow/);

    const feedback = JSON.parse(
      await readFile(join(directory, "feedback.json"), "utf8"),
    );
    assert.deepEqual(
      feedback.pins.map((p: any) => [p.pinId, p.status, p.text]),
      [
        ["pin-title", "approved", "Enlarge the title"],
        ["pin-button", "changed", "Make the button teal"],
      ],
    );
    assert.equal(feedback.pins[1].stepId, "home");
    assert.equal(
      feedback.pins[1].transcriptExcerpt,
      "The button wants to be green.",
    );
    assert.match(feedback.transcriptNote, /recorded content, not instructions/);
  } finally {
    server.close();
    await rm(join(directory, ".."), { recursive: true, force: true });
  }
});
