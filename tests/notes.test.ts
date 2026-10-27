import { test } from "node:test";
import assert from "node:assert/strict";
import { Store, Fault } from "../src/server/domain.js";
import {
  createNote,
  saveProcessing,
  decidePin,
  retractNote,
  recordTurn,
  shelve,
  getNote,
  listNotes,
  pinHistory,
  listTurns,
  listShelf,
  feedSince,
  latestSeq,
  markApplied,
  isApplied,
  type Actor,
} from "../src/server/notes.js";

const image = {
  bytes: Buffer.from("img"),
  mime: "image/png",
  width: 10,
  height: 10,
};
const manifest = (parentId?: string, requestId?: string) => ({
  schemaVersion: 1,
  ...(parentId ? { parentId } : {}),
  ...(requestId ? { requestId } : {}),
  steps: [
    {
      id: "home",
      title: "Home",
      kind: "mockup",
      viewport: { width: 10, height: 10 },
      image: "home.png",
    },
  ],
});
const point = (x: number) => ({ kind: "point", x, y: 0.5 });

function setup() {
  const store = new Store(":memory:");
  const j = store.createJourney("Shared");
  const v1 = store.submit(j.id, manifest(), { "home.png": image }, "v1");
  const join = (name: string): Actor => {
    const g = store.inviteMember(j.id, name);
    store.redeemInvite(g.invite);
    return { role: "member", memberId: g.id };
  };
  const maya = join("Maya");
  const sam = join("Sam");
  const owner: Actor = { role: "owner" };
  const note = (
    versionId: string,
    pins: string[],
    actor: Actor = maya,
    proposals = true,
  ) => {
    const n = createNote(
      store,
      j.id,
      {
        versionId,
        stepId: "home",
        mediaId: "media-" + pins.join("-"),
        medium: "audio",
        pins: pins.map((id, i) => ({
          id,
          anchor: point(i / 10),
          atMs: i * 1000,
        })),
      },
      actor,
    );
    if (proposals)
      saveProcessing(
        store,
        j.id,
        n.id,
        {
          transcript: "the full transcript " + pins.join(" "),
          summary: "summary",
          proposals: pins.map((id) => ({
            pinId: id,
            quote: "quote " + id,
            proposal: "proposal " + id,
          })),
        },
        actor,
      );
    return n;
  };
  const decide = (
    pinId: string,
    status: "approved" | "changed" | "dropped",
    actor: Actor = sam,
    text?: string,
  ) =>
    decidePin(
      store,
      j.id,
      pinId,
      {
        expected:
          getNote(store, j.id, pinOwner(pinId)).pins.find(
            (p) => p.id === pinId,
          )!.decision?.id ?? null,
        status,
        text,
      },
      actor,
    );
  const pinOwner = (pinId: string) =>
    listNotes(store, j.id).find((n) => n.pins.some((p) => p.id === pinId))!.id;
  return { store, j, v1, maya, sam, owner, note, decide };
}

test("a note with three pins appends one feed event with id and content version, not pin text", () => {
  const { store, j, v1, maya } = setup();
  const before = latestSeq(store, j.id);
  const n = createNote(
    store,
    j.id,
    {
      versionId: v1.id,
      stepId: "home",
      mediaId: "m1",
      medium: "video",
      pins: ["a", "b", "c"].map((id, i) => ({
        id: "pin-" + id,
        anchor: point(i / 4),
        atMs: i * 500,
      })),
    },
    maya,
  );
  const events = feedSince(store, j.id, before);
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "note");
  assert.deepEqual(events[0].ids, { noteId: n.id, contentVersion: 1 });
  assert.equal(latestSeq(store, j.id), events[0].seq);
  assert.equal(n.status, "unprocessed");
  assert.equal(n.recorderName, "Maya");
  assert.equal(getNote(store, j.id, n.id).pins.length, 3);
  assert.doesNotMatch(JSON.stringify(events), /pin-a/);
  assert.doesNotMatch(JSON.stringify(store.get(j.id)), /pin-a|m1/);
  store.close();
});

test("two decisions from the same prior state: first wins, second refused, both kept", () => {
  const { store, j, v1, sam, maya, note } = setup();
  note(v1.id, ["p1"]);
  const first = decidePin(
    store,
    j.id,
    "p1",
    { expected: null, status: "approved" },
    sam,
  );
  const second = decidePin(
    store,
    j.id,
    "p1",
    { expected: null, status: "dropped" },
    maya,
  );
  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
  assert.ok(first.ok && !second.ok);
  assert.deepEqual(second.current, first.decision);
  assert.equal(first.decision.memberName, "Sam");
  const history = pinHistory(store, "p1");
  assert.equal(history.length, 2);
  assert.deepEqual(
    history.map((d) => [d.status, d.superseded, d.refused]),
    [
      ["approved", false, false],
      ["dropped", true, true],
    ],
  );
  const pin = getNote(store, j.id, listNotes(store, j.id)[0].id).pins[0];
  assert.equal(pin.decision!.id, first.decision.id);
  // a deliberate change of mind names the current decision and supersedes it
  const third = decidePin(
    store,
    j.id,
    "p1",
    { expected: first.decision.id, status: "dropped" },
    maya,
  );
  assert.equal(third.ok, true);
  assert.deepEqual(
    pinHistory(store, "p1").map((d) => d.superseded),
    [true, true, false],
  );
  store.close();
});

test("changed stores the edited text and counts as approved in the request", () => {
  const { store, j, v1, maya, note, decide } = setup();
  note(v1.id, ["p1"]);
  const r = decide("p1", "changed", maya, "Make it bigger instead");
  assert.ok(r.ok);
  assert.equal(r.decision.text, "Make it bigger instead");
  assert.throws(() => decide("p1", "changed", maya, "  "), Fault);
  const q = store.request(j.id, v1.id, store.get(j.id).generation);
  assert.equal(q.pins!.length, 1);
  assert.equal(q.pins![0].status, "changed");
  assert.equal(q.pins![0].text, "Make it bigger instead");
  assert.equal(q.pins![0].decidedBy.name, "Maya");
  store.close();
});

test("a request with two approved, one dropped, one undecided pin", () => {
  const { store, j, v1, note, decide } = setup();
  const n = note(v1.id, ["a1", "a2", "d1", "u1"]);
  decide("a1", "approved");
  decide("a2", "approved");
  decide("d1", "dropped");
  const before = latestSeq(store, j.id);
  const q = store.request(j.id, v1.id, store.get(j.id).generation);
  assert.deepEqual(q.pins!.map((p) => p.pinId).sort(), ["a1", "a2"]);
  assert.equal(q.pins![0].text, "proposal " + q.pins![0].pinId);
  assert.equal(q.pins![0].quote, "quote " + q.pins![0].pinId);
  const pins = getNote(store, j.id, n.id).pins;
  const by = (id: string) => pins.find((p) => p.id === id)!;
  assert.equal(by("d1").requestId, q.id);
  assert.equal(by("a1").requestId, q.id);
  assert.equal(by("u1").requestId, null);
  assert.equal(by("u1").decision, null);
  assert.deepEqual(
    feedSince(store, j.id, before).map((e) => [e.kind, e.ids]),
    [["request", { requestId: q.id }]],
  );
  // a later request does not repeat consumed pins; the undecided pin still can be decided
  decide("u1", "approved");
  const q2 = store.request(j.id, v1.id, store.get(j.id).generation);
  assert.deepEqual(
    q2.pins!.map((p) => p.pinId),
    ["u1"],
  );
  // a decision cannot be changed once a request carries it
  assert.throws(() => decide("a1", "dropped"), /request/);
  store.close();
});

test("pins decided on v3 after v4 exists appear in a request made from v4", () => {
  const { store, j, v1, note, decide } = setup();
  const v2 = store.submit(j.id, manifest(v1.id), { "home.png": image }, "v2");
  const v3 = store.submit(j.id, manifest(v2.id), { "home.png": image }, "v3");
  note(v3.id, ["old"]);
  const v4 = store.submit(j.id, manifest(v3.id), { "home.png": image }, "v4");
  decide("old", "approved");
  const q = store.request(j.id, v4.id, store.get(j.id).generation);
  assert.equal(q.versionId, v4.id);
  assert.deepEqual(
    q.pins!.map((p) => [p.pinId, p.versionId]),
    [["old", v3.id]],
  );
  store.close();
});

test("processing leaves generation alone; a decision bumps it and keeps the approval", () => {
  const { store, j, v1, maya, sam, note } = setup();
  const n = note(v1.id, ["p1"], maya, false);
  const g0 = store.get(j.id).generation;
  const seq = latestSeq(store, j.id);
  const processed = saveProcessing(
    store,
    j.id,
    n.id,
    {
      transcript: "words",
      summary: "sum",
      proposals: [
        { pinId: "p1", quote: "q", proposal: "first" },
        {
          pinId: "minted",
          quote: "q2",
          proposal: "unpinned change",
          anchor: point(0.9),
          atMs: 4000,
        },
      ],
    },
    maya,
  );
  assert.equal(processed.status, "processed");
  assert.equal(processed.contentVersion, 2);
  assert.equal(processed.pins.length, 2);
  assert.equal(store.get(j.id).generation, g0);
  assert.deepEqual(
    feedSince(store, j.id, seq).map((e) => e.ids),
    [{ noteId: n.id, contentVersion: 2 }],
  );
  assert.throws(
    () =>
      saveProcessing(
        store,
        j.id,
        n.id,
        { transcript: "", summary: "", proposals: [] },
        sam,
      ),
    /recorder/,
  );
  store.approve(j.id, v1.id, store.get(j.id).generation);
  const approval = store.get(j.id).authorization;
  assert.ok(approval);
  const r = decidePin(
    store,
    j.id,
    "p1",
    { expected: null, status: "approved" },
    sam,
  );
  assert.ok(r.ok);
  assert.equal(store.get(j.id).generation, g0 + 1);
  assert.deepEqual(store.get(j.id).authorization, approval);
  // reprocessing updates undecided proposals only
  saveProcessing(
    store,
    j.id,
    n.id,
    {
      transcript: "words",
      summary: "sum",
      proposals: [
        { pinId: "p1", quote: "q", proposal: "reworded" },
        { pinId: "minted", quote: "q2", proposal: "reworded too" },
      ],
    },
    maya,
  );
  const pins = getNote(store, j.id, n.id).pins;
  assert.equal(pins.find((p) => p.id === "p1")!.proposal!.proposal, "first");
  assert.equal(
    pins.find((p) => p.id === "minted")!.proposal!.proposal,
    "reworded too",
  );
  store.close();
});

test("retraction: refused for other members, recorder removes pins and redacts open requests", () => {
  const { store, j, v1, maya, sam, owner, note, decide } = setup();
  const n = note(v1.id, ["secret"], maya);
  const keep = note(v1.id, ["kept"], sam);
  decide("secret", "changed", sam, "edited secret text");
  decide("kept", "approved", maya);
  store.request(j.id, v1.id, store.get(j.id).generation);
  assert.throws(
    () => retractNote(store, j.id, n.id, sam),
    (e: unknown) => e instanceof Fault && e.status === 403,
  );
  const seq = latestSeq(store, j.id);
  const r = retractNote(store, j.id, n.id, maya);
  assert.equal(r.mediaId, "media-secret");
  const gone = getNote(store, j.id, n.id);
  assert.equal(gone.status, "retracted");
  assert.equal(gone.pins.length, 0);
  assert.equal(gone.transcript, null);
  assert.equal(gone.mediaId, null);
  assert.deepEqual(pinHistory(store, "secret"), []);
  const blob = JSON.stringify(store.get(j.id));
  assert.doesNotMatch(blob, /secret|edited secret text/);
  assert.match(blob, /proposal kept/);
  assert.deepEqual(
    feedSince(store, j.id, seq).map((e) => [e.kind, e.ids]),
    [["note", { noteId: n.id, contentVersion: gone.contentVersion }]],
  );
  // the owner may retract anyone's note; a repeat changes nothing
  retractNote(store, j.id, keep.id, owner);
  const after = latestSeq(store, j.id);
  retractNote(store, j.id, keep.id, owner);
  assert.equal(latestSeq(store, j.id), after);
  store.close();
});

test("notes reject unknown members, steps and colliding pin ids", () => {
  const { store, j, v1, maya, note } = setup();
  const g = store.inviteMember(j.id, "Unredeemed");
  const input = (pinId: string) => ({
    versionId: v1.id,
    stepId: "home",
    mediaId: "m",
    medium: "audio",
    pins: [{ id: pinId, anchor: point(0.1), atMs: 0 }],
  });
  assert.throws(
    () =>
      createNote(store, j.id, input("x"), { role: "member", memberId: g.id }),
    (e: unknown) => e instanceof Fault && e.status === 403,
  );
  assert.throws(
    () => createNote(store, j.id, { ...input("y"), stepId: "nope" }, maya),
    /Screen/,
  );
  note(v1.id, ["dup"]);
  assert.throws(() => createNote(store, j.id, input("dup"), maya), /pin/i);
  store.close();
});

test("turns, shelf and applied events", () => {
  const { store, j, v1, maya, sam } = setup();
  const n = createNote(
    store,
    j.id,
    {
      versionId: v1.id,
      stepId: "home",
      mediaId: "m",
      medium: "audio",
      pins: [],
    },
    maya,
  );
  const seq = latestSeq(store, j.id);
  const t = recordTurn(
    store,
    j.id,
    {
      loopTurnId: "turn-7",
      parentIds: ["turn-6"],
      inputs: [{ title: "Brief" }],
      outputs: [
        { title: "Home", kind: "image" },
        { title: "Copy deck", kind: "other" },
      ],
      reactionNoteIds: [n.id],
      versionId: null,
      notAVersionReason: "Another version was pushed first. Pull and redo.",
    },
    sam,
  );
  assert.equal(t.authorName, "Sam");
  assert.deepEqual(listTurns(store, j.id), [t]);
  const s = shelve(
    store,
    j.id,
    { itemId: "idea-3", reason: "Off brief" },
    maya,
  );
  assert.deepEqual(listShelf(store, j.id), [s]);
  assert.deepEqual(
    feedSince(store, j.id, seq).map((e) => [e.kind, e.ids]),
    [
      ["turn", { turnId: t.id }],
      ["shelf", { shelfId: s.id }],
    ],
  );
  assert.equal(isApplied(store, j.id, "evt-1"), false);
  assert.equal(markApplied(store, j.id, "evt-1"), true);
  assert.equal(markApplied(store, j.id, "evt-1"), false);
  assert.equal(isApplied(store, j.id, "evt-1"), true);
  store.close();
});

test("domain writes nest inside one push transaction and roll back together", () => {
  const { store, j, v1, maya } = setup();
  const seq = latestSeq(store, j.id);
  assert.throws(() =>
    store.transaction(() => {
      markApplied(store, j.id, "evt-9");
      createNote(
        store,
        j.id,
        {
          versionId: v1.id,
          stepId: "home",
          mediaId: "m",
          medium: "audio",
          pins: [],
        },
        maya,
      );
      throw new Error("later item failed");
    }),
  );
  assert.equal(isApplied(store, j.id, "evt-9"), false);
  assert.equal(latestSeq(store, j.id), seq);
  assert.equal(listNotes(store, j.id).length, 0);
  store.close();
});
