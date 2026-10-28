import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  NotesPanel,
  hasUnsentDecisions,
  openPins,
  pinTitle,
  time,
} from "../src/client/PinDecisions.js";
import { stepsLine } from "../src/client/App.js";
import type { Pin, PinDecision, VideoNote } from "../src/shared/model.js";

const decision = (
  status: PinDecision["status"],
  text: string | null,
): PinDecision => ({
  id: `d-${status}`,
  pinId: "p",
  status,
  text,
  memberId: "m",
  memberName: "Amadeo",
  at: Date.UTC(2026, 9, 27, 16, 47),
  superseded: false,
  refused: false,
});
const pin = (extra: Partial<Pin> = {}): Pin => ({
  id: "p1",
  noteId: "n1",
  anchor: { kind: "point", x: 0.5, y: 0.5 },
  atMs: 1000,
  proposal: { quote: "the title", proposal: "Enlarge the title" },
  decision: null,
  requestId: null,
  ...extra,
});
const note = (pins: Pin[], extra: Partial<VideoNote> = {}): VideoNote => ({
  id: "n1",
  journey: "j",
  versionId: "v",
  stepId: "home",
  recorderId: "m",
  recorderName: "Alex",
  mediaId: "media-1",
  medium: "audio",
  status: "processed",
  transcript: null,
  summary: "One point",
  contentVersion: 1,
  createdAt: 0,
  loopNoteId: null,
  pins,
  ...extra,
});
const render = (notes: VideoNote[]) =>
  renderToStaticMarkup(
    createElement(NotesPanel, {
      journeyId: "j",
      notes,
      selected: null,
      onSelect: () => {},
      onChanged: async () => {},
    }),
  );

test("a changed comment's row shows the changed text; others show the proposal", () => {
  assert.equal(
    pinTitle(pin({ decision: decision("changed", "Make it teal") }), 1),
    "Make it teal",
  );
  assert.equal(
    pinTitle(pin({ decision: decision("approved", "Enlarge the title") }), 1),
    "Enlarge the title",
  );
  assert.equal(pinTitle(pin({ proposal: null }), 2), "Comment 2");
});

test("times have no leading zero on the hour", () => {
  const at = new Date(2026, 9, 27, 16, 47).getTime();
  assert.doesNotMatch(time(at), /^0/);
  assert.match(time(at), /4:47|16:47/);
});

test("Request revision has something to send only when a decided comment is outside a request", () => {
  assert.equal(hasUnsentDecisions([note([pin()])]), false);
  assert.equal(
    hasUnsentDecisions([note([pin({ decision: decision("dropped", null) })])]),
    true,
  );
  assert.equal(
    hasUnsentDecisions([
      note([pin({ decision: decision("approved", "x"), requestId: "r1" })]),
    ]),
    false,
  );
});

test("rows in a revision request say so", () => {
  const html = render([
    note([
      pin({ decision: decision("approved", "x"), requestId: "r1" }),
      pin({ id: "p2", decision: decision("approved", "y") }),
    ]),
  ]);
  assert.equal(html.match(/In revision request/g)?.length, 1);
});

test("a processed note can be played back; an unprocessed one cannot", () => {
  const audio = render([note([pin()])]);
  assert.match(
    audio,
    /<audio class="note-player" controls="" preload="metadata" src="\/api\/journeys\/j\/media\/media-1" aria-label="Play Alex&#x27;s voice note"/,
  );
  assert.match(
    render([note([pin()], { medium: "video" })]),
    /<video class="note-player"/,
  );
  assert.doesNotMatch(
    render([note([pin()], { status: "unprocessed" })]),
    /note-player/,
  );
});

test("What I heard lists a processed note's comments and keeps open rows behind Change it", () => {
  const html = render([
    note([
      pin(),
      pin({ id: "p2", proposal: { quote: "q", proposal: "Warm it up" } }),
    ]),
  ]);
  assert.match(html, /<h3>Comments · 1<\/h3>/);
  assert.match(html, /aria-label="What I heard"/);
  assert.deepEqual(
    [...html.matchAll(/class="heard-title">([^<]+)</g)].map((m) => m[1]),
    ["Enlarge the title", "Warm it up"],
  );
  assert.match(html, />Yes, do it</);
  assert.match(html, /aria-expanded="false">Change it</);
  assert.doesNotMatch(html, /pin-row/);
});

test("with nothing open, Yes, do it is disabled and the rows show", () => {
  const html = render([note([pin({ decision: decision("approved", "x") })])]);
  assert.match(html, /<button disabled="">Yes, do it</);
  assert.doesNotMatch(html, /Change it/);
  assert.match(html, /pin-row/);
});

test("an unprocessed note waits for the recorder's Mac and shows its rows", () => {
  const html = render([
    note([pin({ proposal: null })], { status: "unprocessed", summary: null }),
  ]);
  assert.match(html, /Waiting for Alex&#x27;s Mac/);
  assert.doesNotMatch(html, /What I heard/);
  assert.match(html, /pin-row/);
});

test("open comments are undecided, outside a request and have a proposal", () => {
  const pins = [
    pin(),
    pin({ id: "p2", decision: decision("dropped", null) }),
    pin({ id: "p3", requestId: "r1" }),
    pin({ id: "p4", proposal: null }),
  ];
  assert.deepEqual(
    openPins(note(pins)).map((p) => p.id),
    ["p1"],
  );
  assert.deepEqual(openPins(note(pins, { status: "unprocessed" })), []);
});

test("the steps line leaves out unknown capture coverage", () => {
  assert.equal(stepsLine(2, "unknown"), "2 steps");
  assert.equal(stepsLine(1, "complete"), "1 step · every screen captured");
  assert.equal(
    stepsLine(3, "partial"),
    "3 steps · some screens not captured yet",
  );
});
