import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { createServer } from "../src/server/http.js";
import { Store } from "../src/server/domain.js";
import { Readable } from "node:stream";
import { getMedia, saveUpload } from "../src/server/media.js";
import {
  getNote,
  isApplied,
  latestSeq,
  listNotes,
  listTurns,
  pinHistory,
} from "../src/server/notes.js";

const origin = "http://localhost:4199";
const point = (x: number) => ({ kind: "point", x, y: 0.5 });
const png = (color: string) =>
  sharp({ create: { width: 8, height: 8, channels: 3, background: color } })
    .png()
    .toBuffer();
const step = (image?: string) => ({
  id: "home",
  title: "Home",
  kind: "mockup",
  viewport: { width: 8, height: 8 },
  ...(image ? { image } : {}),
});

async function setup() {
  const store = new Store(":memory:");
  const mediaDir = mkdtempSync(join(tmpdir(), "sg-sync-"));
  const server = createServer({
    store,
    secret: "owner",
    origin,
    mediaDir,
  }).listen(0);
  const base = `http://localhost:${(server.address() as { port: number }).port}/api`;
  const call = async (
    path: string,
    o: {
      body?: unknown;
      token?: string;
      cookie?: string;
      method?: string;
    } = {},
  ) => {
    const r = await fetch(base + path, {
      method: o.method ?? (o.body === undefined ? "GET" : "POST"),
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        ...(o.token ? { Authorization: `Bearer ${o.token}` } : {}),
        ...(o.cookie ? { Cookie: o.cookie } : {}),
      },
      body: o.body === undefined ? undefined : JSON.stringify(o.body),
    });
    const text = await r.text();
    return {
      status: r.status,
      body: text ? JSON.parse(text) : null,
      headers: r.headers,
    };
  };
  const login = await call("/login", { body: { secret: "owner" } });
  const ownerCookie = login.headers.get("set-cookie")!.split(";")[0];
  const j = store.createJourney("Shared");
  const v1 = store.submit(
    j.id,
    {
      schemaVersion: 1,
      steps: [step("home.png")],
    },
    {
      "home.png": {
        bytes: await png("#fff"),
        mime: "image/png",
        width: 8,
        height: 8,
      },
    },
    "v1",
  );
  const join_ = (name: string, journey = j.id) => {
    const g = store.inviteMember(journey, name);
    const { token } = store.redeemInvite(g.invite);
    return { id: g.id, token, name };
  };
  const alex = join_("Alex");
  const amadeo = join_("Amadeo");
  const upload = async (token: string, bytes: Buffer, mime: string) => {
    const r = await fetch(`${base}/journeys/${j.id}/media`, {
      method: "PUT",
      headers: { "Content-Type": mime, Authorization: `Bearer ${token}` },
      body: new Uint8Array(bytes),
    });
    assert.ok(r.status === 201 || r.status === 200, String(r.status));
    return ((await r.json()) as { id: string }).id;
  };
  const recording = (token: string) =>
    upload(token, randomBytes(2048), "audio/webm");
  const link = (token: string, confidential = false) =>
    call(`/journeys/${j.id}/link`, {
      token,
      body: { seedId: "seed-1", bed: "shared:team", confidential },
    });
  const push = (token: string, body: Record<string, unknown>) =>
    call(`/journeys/${j.id}/sync/push`, {
      token,
      body: {
        link: { seedId: "seed-1", bed: "shared:team", confidential: false },
        ...body,
      },
    });
  const pushedNote = async (
    token: string,
    eventId: string,
    pins: string[],
    processed = true,
  ) => ({
    eventId,
    versionId: store.get(j.id).currentId!,
    stepId: "home",
    medium: "audio",
    pins: pins.map((id, i) => ({ id, anchor: point(i / 10), atMs: i * 500 })),
    files: [
      { name: "audio", mediaId: await recording(token) },
      { name: "transcript", text: "we should make the title bigger" },
    ],
    ...(processed
      ? {
          processing: {
            transcript: "we should make the title bigger",
            summary: "title",
            proposals: pins.map((id) => ({
              pinId: id,
              quote: "make the title bigger",
              proposal: `bigger title ${id}`,
            })),
          },
        }
      : {}),
  });
  const galleryNote = async (
    who: { token: string },
    mediaId: string,
    pins: string[] = ["g1"],
  ) =>
    call(`/journeys/${j.id}/notes`, {
      token: who.token,
      body: {
        versionId: store.get(j.id).currentId,
        stepId: "home",
        mediaId,
        medium: "audio",
        pins: pins.map((id, i) => ({ id, anchor: point(i / 10), atMs: i })),
      },
    });
  return {
    store,
    mediaDir,
    j,
    v1,
    alex,
    amadeo,
    join: join_,
    ownerCookie,
    call,
    upload,
    recording,
    link,
    push,
    pushedNote,
    galleryNote,
    close() {
      server.close();
      store.close();
      rmSync(mediaDir, { recursive: true, force: true });
    },
  };
}
type T = Awaited<ReturnType<typeof setup>>;
const run = (fn: (t: T) => Promise<void>) => async () => {
  const t = await setup();
  try {
    await fn(t);
  } finally {
    t.close();
  }
};
const mediaPath = (t: T, id: string) =>
  join(t.mediaDir, getMedia(t.store, id)!.path);

test(
  "recording is refused without a linked Loop or on a confidential link, then allowed",
  run(async (t) => {
    const media = await t.recording(t.alex.token);
    let r = await t.galleryNote(t.alex, media);
    assert.equal(r.status, 409);
    assert.match(r.body.error.message, /Link your Loop/);

    assert.equal((await t.link(t.alex.token, true)).status, 200);
    assert.ok(t.store.memberGrant(t.alex.id)!.linkedLoopAt);
    r = await t.galleryNote(t.alex, media);
    assert.equal(r.status, 409);
    assert.match(r.body.error.message, /confidential/);
    const poll = await t.call(`/journeys/${t.j.id}`, { token: t.alex.token });
    assert.equal(poll.body.confidential, true);

    // A confidential seed's push may not carry notes.
    const p = await t.push(t.alex.token, {
      link: { seedId: "seed-1", bed: "shared:team", confidential: true },
      notes: [await t.pushedNote(t.alex.token, "e-conf", ["c1"])],
    });
    assert.equal(p.status, 409);
    assert.equal(listNotes(t.store, t.j.id).length, 0);

    // Members cannot clear the flag from the gallery; the owner can.
    const memberClear = await t.call(`/journeys/${t.j.id}/link/confidential`, {
      token: t.alex.token,
      body: { confidential: false },
    });
    assert.equal(memberClear.status, 403);
    const ownerClear = await t.call(`/journeys/${t.j.id}/link/confidential`, {
      cookie: t.ownerCookie,
      body: { confidential: false },
    });
    assert.equal(ownerClear.status, 200);

    r = await t.galleryNote(t.alex, media);
    assert.equal(r.status, 201);
    assert.equal(r.body.recorderName, "Alex");
    assert.equal(r.body.status, "unprocessed");
    assert.equal(getMedia(t.store, media)!.restrictedTo, t.alex.id);
  }),
);

test(
  "a note's media must be this journey's, uploaded by the recorder, and used once",
  run(async (t) => {
    await t.link(t.alex.token);
    await t.link(t.amadeo.token);
    const other = t.store.createJourney("Other");
    const outsider = t.join("Outsider", other.id);
    const { media: otherMedia } = await saveUpload(t.store, t.mediaDir, {
      journey: other.id,
      uploader: outsider.id,
      contentType: "audio/webm",
      contentLength: undefined,
      body: Readable.from([randomBytes(1024)]),
    });
    let r = await t.galleryNote(t.alex, otherMedia.id);
    assert.equal(r.status, 400);
    const amadeosMedia = await t.recording(t.amadeo.token);
    r = await t.galleryNote(t.alex, amadeosMedia);
    assert.equal(r.status, 403);

    const mine = await t.recording(t.alex.token);
    assert.equal((await t.galleryNote(t.alex, mine, ["a1"])).status, 201);
    r = await t.galleryNote(t.alex, mine, ["a2"]);
    assert.equal(r.status, 409);
    assert.match(r.body.error.message, /already belongs/);
    assert.equal(listNotes(t.store, t.j.id).length, 1);
  }),
);

test(
  "the gallery lists an unprocessed note's media only to its recorder",
  run(async (t) => {
    await t.link(t.alex.token);
    const media = await t.recording(t.alex.token);
    await t.galleryNote(t.alex, media);
    const mine = await t.call(`/journeys/${t.j.id}/notes`, {
      token: t.alex.token,
    });
    const theirs = await t.call(
      `/journeys/${t.j.id}/notes?versionId=${t.v1.id}`,
      { token: t.amadeo.token },
    );
    assert.equal(mine.body.notes[0].mediaId, media);
    assert.equal(theirs.body.notes[0].mediaId, null);
    assert.equal(theirs.body.latestSeq, latestSeq(t.store, t.j.id));
  }),
);

test(
  "a losing pin decision returns 409 with the winning decision, and history keeps both",
  run(async (t) => {
    await t.link(t.alex.token);
    const p = await t.push(t.alex.token, {
      notes: [await t.pushedNote(t.alex.token, "e1", ["p1"])],
    });
    assert.equal(p.status, 200, JSON.stringify(p.body));
    const decide = (token: string) =>
      t.call(`/journeys/${t.j.id}/pins/p1/decisions`, {
        token,
        body: { expected: null, status: "approved" },
      });
    const first = await decide(t.alex.token);
    assert.equal(first.status, 201);
    const second = await decide(t.amadeo.token);
    assert.equal(second.status, 409);
    assert.equal(second.body.current.memberName, "Alex");
    assert.equal(second.body.current.at, first.body.decision.at);
    const history = await t.call(`/journeys/${t.j.id}/pins/p1/history`, {
      token: t.amadeo.token,
    });
    assert.equal(history.body.decisions.length, 2);
    assert.deepEqual(
      history.body.decisions.map((d: any) => [d.memberName, d.refused]),
      [
        ["Alex", false],
        ["Amadeo", true],
      ],
    );
  }),
);

test(
  "pushing the same payload twice applies nothing new and returns the same result",
  run(async (t) => {
    const body = {
      notes: [await t.pushedNote(t.alex.token, "e1", ["p1", "p2"])],
      shelf: [{ eventId: "e2", itemId: "idea-1", reason: "later" }],
    };
    const a = await t.push(t.alex.token, body);
    assert.equal(a.status, 200, JSON.stringify(a.body));
    const seq = latestSeq(t.store, t.j.id);
    const b = await t.push(t.alex.token, body);
    assert.equal(b.status, 200);
    assert.deepEqual(b.body, a.body);
    assert.equal(latestSeq(t.store, t.j.id), seq);
    assert.equal(listNotes(t.store, t.j.id).length, 1);
  }),
);

test(
  "a push whose third item fails leaves nothing from the first two",
  run(async (t) => {
    const bad = await t.pushedNote(t.alex.token, "e3", ["p3"]);
    bad.files[0].mediaId = "missing-media";
    const r = await t.push(t.alex.token, {
      notes: [
        await t.pushedNote(t.alex.token, "e1", ["p1"]),
        await t.pushedNote(t.alex.token, "e2", ["p2"]),
        bad,
      ],
    });
    assert.equal(r.status, 400);
    assert.match(r.body.error.message, /missing-media/);
    assert.equal(listNotes(t.store, t.j.id).length, 0);
    assert.equal(isApplied(t.store, t.j.id, "e1"), false);
    assert.equal(latestSeq(t.store, t.j.id), 1); // only v1
  }),
);

test(
  "two pushes of a v4 from v3: the first is the version, the second a turn marked not a version",
  run(async (t) => {
    const parent = t.store.get(t.j.id).currentId;
    const turn = async (who: T["alex"], loopTurnId: string, color: string) => ({
      eventId: `ev-${loopTurnId}`,
      loopTurnId,
      parentIds: ["loop-v3"],
      parentVersionId: parent,
      inputs: [{ title: "notes" }],
      outputs: [{ title: "home", kind: "image" }],
      reactionNoteIds: [],
      version: {
        title: "v4",
        steps: [step(await t.upload(who.token, await png(color), "image/png"))],
      },
    });
    const a = await t.push(t.alex.token, {
      turns: [await turn(t.alex, "t-alex", "#f00")],
    });
    assert.equal(a.status, 200, JSON.stringify(a.body));
    const b = await t.push(t.amadeo.token, {
      turns: [await turn(t.amadeo, "t-amadeo", "#0f0")],
    });
    assert.equal(b.status, 200, JSON.stringify(b.body));
    const j = t.store.get(t.j.id);
    assert.equal(j.versions.length, 2);
    assert.equal(j.currentId, a.body.results[0].versionId);
    assert.equal(b.body.results[0].versionId, null);
    assert.match(b.body.results[0].notAVersionReason, /[Pp]ull/);
    const turns = listTurns(t.store, t.j.id);
    assert.deepEqual(
      turns.map((x) => [x.authorName, !!x.versionId, !!x.notAVersionReason]),
      [
        ["Alex", true, false],
        ["Amadeo", false, true],
      ],
    );
  }),
);

test(
  "the feed of a non-recorder omits an unprocessed note's raw media until it is processed",
  run(async (t) => {
    await t.link(t.alex.token);
    const media = await t.recording(t.alex.token);
    const note = (await t.galleryNote(t.alex, media)).body;
    const feed = (who: T["alex"]) =>
      t.call(`/journeys/${t.j.id}/sync/feed?after=0`, { token: who.token });
    const alexFeed = await feed(t.alex);
    const ev = alexFeed.body.events.find(
      (e: any) => e.kind === "note" && e.ids.noteId === note.id,
    );
    assert.equal(ev.ids.mediaId, media);
    let amadeoFeed = await feed(t.amadeo);
    assert.ok(
      !amadeoFeed.body.events.some((e: any) => e.ids.noteId === note.id),
    );
    assert.equal(amadeoFeed.body.next, latestSeq(t.store, t.j.id));
    assert.ok(!JSON.stringify(amadeoFeed.body).includes(media));
    const content = await t.call(
      `/journeys/${t.j.id}/sync/content?notes=${note.id}`,
      { token: t.amadeo.token },
    );
    assert.equal(content.body.notes[0].mediaId, null);

    const p = await t.push(t.alex.token, {
      processing: [
        {
          eventId: "proc-1",
          noteId: note.id,
          transcript: "make it bigger",
          summary: "bigger",
          proposals: [{ pinId: "g1", quote: "bigger", proposal: "Bigger" }],
          files: [{ name: "readback", text: "Bigger title" }],
        },
      ],
    });
    assert.equal(p.status, 200, JSON.stringify(p.body));
    assert.equal(getMedia(t.store, media)!.restrictedTo, null);
    amadeoFeed = await feed(t.amadeo);
    assert.ok(
      amadeoFeed.body.events.some((e: any) => e.ids.noteId === note.id),
    );
  }),
);

test(
  "a retraction removes the media and other members' pulls see the tombstone",
  run(async (t) => {
    const n = await t.pushedNote(t.alex.token, "e1", ["p1"]);
    const frame = await t.upload(t.alex.token, await png("#00f"), "image/png");
    n.files.push({ name: "frames/1.png", mediaId: frame } as any);
    const p = await t.push(t.alex.token, { notes: [n] });
    assert.equal(p.status, 200, JSON.stringify(p.body));
    const noteId = p.body.results[0].noteId;
    const audio = n.files[0].mediaId!;
    const files = [mediaPath(t, audio), mediaPath(t, frame)];
    assert.ok(files.every(existsSync));
    const seen = latestSeq(t.store, t.j.id);

    const r = await t.push(t.alex.token, {
      retractions: [{ eventId: "e2", noteId }],
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(!files.some(existsSync));
    assert.equal(getMedia(t.store, audio), null);

    const feed = await t.call(`/journeys/${t.j.id}/sync/feed?after=${seen}`, {
      token: t.amadeo.token,
    });
    assert.ok(
      feed.body.events.some(
        (e: any) => e.kind === "note" && e.ids.noteId === noteId,
      ),
    );
    const c = await t.call(`/journeys/${t.j.id}/sync/content?notes=${noteId}`, {
      token: t.amadeo.token,
    });
    const tomb = c.body.notes[0];
    assert.equal(tomb.status, "retracted");
    assert.deepEqual([tomb.pins, tomb.files, tomb.transcript], [[], [], null]);
  }),
);

test(
  "a push from an agent token is refused",
  run(async (t) => {
    const g = await t.call(`/journeys/${t.j.id}/grants`, {
      cookie: t.ownerCookie,
      body: { role: "agent" },
    });
    const r = await t.push(g.body.token, {
      shelf: [{ eventId: "e1", itemId: "x", reason: "y" }],
    });
    assert.equal(r.status, 403);
  }),
);

test(
  "a pushed decision naming Alex is stored as decided by the pusher",
  run(async (t) => {
    await t.push(t.alex.token, {
      notes: [await t.pushedNote(t.alex.token, "e1", ["p1"])],
    });
    const r = await t.push(t.amadeo.token, {
      decisions: [
        {
          eventId: "d1",
          pinId: "p1",
          expected: null,
          status: "dropped",
          memberId: t.alex.id,
          memberName: "Alex",
          decidedBy: { memberId: t.alex.id, name: "Alex" },
        },
      ],
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const [d] = pinHistory(t.store, "p1");
    assert.deepEqual([d.memberId, d.memberName], [t.amadeo.id, "Amadeo"]);
  }),
);

test(
  "Amadeo retracting Alex's note fails the push and leaves note, media and pins",
  run(async (t) => {
    const n = await t.pushedNote(t.alex.token, "e1", ["p1"]);
    const p = await t.push(t.alex.token, { notes: [n] });
    const noteId = p.body.results[0].noteId;
    const r = await t.push(t.amadeo.token, {
      shelf: [{ eventId: "s1", itemId: "x", reason: "y" }],
      retractions: [{ eventId: "r1", noteId }],
    });
    assert.equal(r.status, 403);
    const note = getNote(t.store, t.j.id, noteId);
    assert.equal(note.status, "processed");
    assert.equal(note.pins.length, 1);
    assert.ok(existsSync(mediaPath(t, n.files[0].mediaId!)));
    assert.equal(isApplied(t.store, t.j.id, "s1"), false);
  }),
);

test(
  "a pushed folder file outside the fixed names is refused",
  run(async (t) => {
    for (const name of ["../x", "frames/../../x.png", "notes.md"]) {
      const n = await t.pushedNote(t.alex.token, `e-${name}`, ["p1"]);
      n.files.push({ name, text: "x" });
      const r = await t.push(t.alex.token, { notes: [n] });
      assert.equal(r.status, 400, name);
    }
    assert.equal(listNotes(t.store, t.j.id).length, 0);
  }),
);

test(
  "a decision and a request-answering version on the same version both apply and set the successor",
  run(async (t) => {
    await t.push(t.alex.token, {
      notes: [await t.pushedNote(t.alex.token, "e1", ["p1", "p2"])],
    });
    const d = await t.call(`/journeys/${t.j.id}/pins/p1/decisions`, {
      token: t.amadeo.token,
      body: { expected: null, status: "approved" },
    });
    assert.equal(d.status, 201);
    const j0 = t.store.get(t.j.id);
    const q = await t.call(`/journeys/${t.j.id}/requests`, {
      token: t.amadeo.token,
      body: { versionId: j0.currentId, generation: j0.generation },
    });
    assert.equal(q.status, 201, JSON.stringify(q.body));
    const image = await t.upload(t.alex.token, await png("#123"), "image/png");
    const r = await t.push(t.alex.token, {
      decisions: [
        { eventId: "d2", pinId: "p2", expected: null, status: "dropped" },
      ],
      turns: [
        {
          eventId: "t1",
          loopTurnId: "turn-1",
          parentIds: ["loop-v1"],
          parentVersionId: j0.currentId,
          requestId: q.body.id,
          responses: { p1: "Made the title bigger" },
          inputs: [{ title: "request" }],
          outputs: [{ title: "home", kind: "image" }],
          reactionNoteIds: [],
          version: { steps: [step(image)] },
        },
      ],
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const j = t.store.get(t.j.id);
    const v = j.versions.at(-1)!;
    assert.equal(r.body.results[1].versionId, v.id);
    assert.equal(v.requestId, q.body.id);
    assert.deepEqual(v.responses, { p1: "Made the title bigger" });
    assert.equal(j.requests.find((x) => x.id === q.body.id)!.successorId, v.id);
    assert.equal(r.body.results[0].ok, true);
  }),
);

test(
  "a member linking after a retraction pulls no content from the retracted note",
  run(async (t) => {
    const p = await t.push(t.alex.token, {
      notes: [await t.pushedNote(t.alex.token, "e1", ["p1"])],
    });
    const noteId = p.body.results[0].noteId;
    await t.push(t.alex.token, { retractions: [{ eventId: "e2", noteId }] });
    const bea = t.join("Bea");
    assert.equal((await t.link(bea.token)).status, 200);
    const feed = await t.call(`/journeys/${t.j.id}/sync/feed?after=0`, {
      token: bea.token,
    });
    const ids = [
      ...new Set(
        feed.body.events
          .filter((e: any) => e.ids.noteId)
          .map((e: any) => e.ids.noteId),
      ),
    ];
    const c = await t.call(
      `/journeys/${t.j.id}/sync/content?notes=${ids.join(",")}`,
      { token: bea.token },
    );
    const text = JSON.stringify(c.body);
    assert.ok(!text.includes("bigger"));
    assert.ok(c.body.notes.every((n: any) => n.status === "retracted"));
  }),
);

test(
  "the owner can discard a stranded unprocessed note; its recording is deleted",
  run(async (t) => {
    await t.link(t.alex.token);
    const media = await t.recording(t.alex.token);
    const note = (await t.galleryNote(t.alex, media)).body;
    const path = mediaPath(t, media);
    const byMember = await t.call(
      `/journeys/${t.j.id}/notes/${note.id}/discard`,
      { token: t.amadeo.token, body: {} },
    );
    assert.equal(byMember.status, 403);
    const r = await t.call(`/journeys/${t.j.id}/notes/${note.id}/discard`, {
      cookie: t.ownerCookie,
      body: {},
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.status, "retracted");
    assert.ok(!existsSync(path));
  }),
);

test(
  "turns and shelf are readable by members",
  run(async (t) => {
    await t.push(t.alex.token, {
      shelf: [{ eventId: "s1", itemId: "idea", reason: "not now" }],
      turns: [
        {
          eventId: "t1",
          loopTurnId: "turn-1",
          parentIds: [],
          parentVersionId: null,
          inputs: [],
          outputs: [{ title: "copy", kind: "other" }],
          reactionNoteIds: [],
        },
      ],
    });
    const turns = await t.call(`/journeys/${t.j.id}/turns`, {
      token: t.amadeo.token,
    });
    const shelf = await t.call(`/journeys/${t.j.id}/shelf`, {
      token: t.amadeo.token,
    });
    assert.equal(turns.body.turns[0].authorName, "Alex");
    assert.equal(turns.body.turns[0].versionId, null);
    assert.equal(shelf.body.shelf[0].reason, "not now");
  }),
);

test(
  "retracting a note keeps a frame another note still uses",
  run(async (t) => {
    const frame = await t.upload(t.alex.token, await png("#abc"), "image/png");
    const a = await t.pushedNote(t.alex.token, "e1", ["p1"]);
    const b = await t.pushedNote(t.alex.token, "e2", ["p2"]);
    for (const n of [a, b])
      n.files.push({ name: "frames/1.png", mediaId: frame } as any);
    const p = await t.push(t.alex.token, { notes: [a, b] });
    assert.equal(p.status, 200, JSON.stringify(p.body));
    const path = mediaPath(t, frame);
    const r = await t.push(t.alex.token, {
      retractions: [{ eventId: "r1", noteId: p.body.results[0].noteId }],
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(existsSync(path));
    assert.ok(getMedia(t.store, frame));
    assert.equal(getMedia(t.store, a.files[0].mediaId!), null);
  }),
);
