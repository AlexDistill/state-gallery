import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { Fault, type Store } from "./domain.js";
import {
  noteInputSchema,
  processingSchema,
  decisionInputSchema,
  turnInputSchema,
  shelfInputSchema,
  type Anchor,
} from "../shared/schema.js";
import type {
  Journey,
  VideoNote,
  Pin,
  PinDecision,
  RequestPin,
  Turn,
  ShelfItem,
  FeedEvent,
  FeedKind,
} from "../shared/model.js";

/** Who is writing. Members are checked against their grant; display names come from the grant. */
export type Actor = { role: "owner" } | { role: "member"; memberId: string };
export type DecisionResult =
  | { ok: true; decision: PinDecision }
  | { ok: false; current: PinDecision | null };

export const NOTES_SCHEMA = `
CREATE TABLE IF NOT EXISTS video_notes(id TEXT PRIMARY KEY,journey TEXT NOT NULL,version_id TEXT NOT NULL,step_id TEXT NOT NULL,recorder_id TEXT,recorder_name TEXT NOT NULL,media_id TEXT,medium TEXT NOT NULL,status TEXT NOT NULL,transcript TEXT,summary TEXT,content_version INTEGER NOT NULL,created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS video_notes_journey ON video_notes(journey);
CREATE UNIQUE INDEX IF NOT EXISTS video_notes_media ON video_notes(media_id) WHERE media_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS pins(id TEXT PRIMARY KEY,note_id TEXT NOT NULL REFERENCES video_notes(id) ON DELETE CASCADE,journey TEXT NOT NULL,anchor TEXT NOT NULL,at_ms INTEGER NOT NULL,request_id TEXT);
CREATE INDEX IF NOT EXISTS pins_note ON pins(note_id);
CREATE INDEX IF NOT EXISTS pins_journey ON pins(journey);
CREATE TABLE IF NOT EXISTS pin_proposals(pin_id TEXT PRIMARY KEY REFERENCES pins(id) ON DELETE CASCADE,quote TEXT NOT NULL,proposal TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS pin_decisions(n INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,pin_id TEXT NOT NULL REFERENCES pins(id) ON DELETE CASCADE,status TEXT NOT NULL,text TEXT,member_id TEXT,member_name TEXT NOT NULL,at INTEGER NOT NULL,superseded INTEGER NOT NULL,refused INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS pin_decisions_pin ON pin_decisions(pin_id);
CREATE TABLE IF NOT EXISTS turns(n INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,journey TEXT NOT NULL,loop_turn_id TEXT NOT NULL,parent_ids TEXT NOT NULL,inputs TEXT NOT NULL,outputs TEXT NOT NULL,reaction_note_ids TEXT NOT NULL,version_id TEXT,not_version_reason TEXT,author_id TEXT,author_name TEXT NOT NULL,at INTEGER NOT NULL,UNIQUE(journey,loop_turn_id));
CREATE TABLE IF NOT EXISTS shelf(n INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,journey TEXT NOT NULL,item_id TEXT NOT NULL,reason TEXT NOT NULL,member_id TEXT,member_name TEXT NOT NULL,at INTEGER NOT NULL,UNIQUE(journey,item_id));
CREATE TABLE IF NOT EXISTS sync_feed(journey TEXT NOT NULL,seq INTEGER NOT NULL,kind TEXT NOT NULL,ids TEXT NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(journey,seq));
CREATE TABLE IF NOT EXISTS applied_events(journey TEXT NOT NULL,event_id TEXT NOT NULL,applied_at INTEGER NOT NULL,PRIMARY KEY(journey,event_id));
`;

type Row = Record<string, unknown>;
const db = (s: Store): DatabaseSync => s.db;
const num = (v: unknown) => Number(v);
const strOrNull = (v: unknown) => (v == null ? null : String(v));

function who(store: Store, journey: string, actor: Actor) {
  if (actor.role === "owner") return { id: null, name: "Owner" };
  const g = store.memberGrant(actor.memberId);
  if (
    !g ||
    g.journey !== journey ||
    g.revokedAt != null ||
    g.redeemedAt == null
  )
    throw new Fault(403, "This member is not part of the journey");
  return { id: g.id as string | null, name: g.name };
}

function stepOf(j: Journey, versionId: string, stepId: string) {
  const s = j.versions
    .find((v) => v.id === versionId)
    ?.steps.find((s) => s.id === stepId);
  if (!s) throw new Fault(400, "Screen does not belong to this version");
  return s;
}

function checkAnchor(anchor: Anchor, step: { assetId?: string }) {
  if (anchor.kind !== "screen" && !step.assetId)
    throw new Fault(400, "Point and region comments need an image");
}

function insertPin(
  store: Store,
  journey: string,
  noteId: string,
  pin: { id: string; anchor: Anchor; atMs: number },
) {
  if (db(store).prepare("SELECT 1 FROM pins WHERE id=?").get(pin.id))
    throw new Fault(409, `Comment id already used: ${pin.id}`);
  db(store)
    .prepare(
      "INSERT INTO pins(id,note_id,journey,anchor,at_ms) VALUES(?,?,?,?,?)",
    )
    .run(pin.id, noteId, journey, JSON.stringify(pin.anchor), pin.atMs);
}

/** Appends one event to the journey's feed. Events carry ids only, never content. */
export function appendFeed(
  store: Store,
  journey: string,
  kind: FeedKind,
  ids: Record<string, string | number>,
  now = Date.now(),
) {
  const seq = latestSeq(store, journey) + 1;
  db(store)
    .prepare("INSERT INTO sync_feed VALUES(?,?,?,?,?)")
    .run(journey, seq, kind, JSON.stringify(ids), now);
  return seq;
}

export function latestSeq(store: Store, journey: string): number {
  const r = db(store)
    .prepare("SELECT MAX(seq) AS seq FROM sync_feed WHERE journey=?")
    .get(journey);
  return r?.seq == null ? 0 : num(r.seq);
}

export function feedSince(
  store: Store,
  journey: string,
  after: number,
  limit = 500,
): FeedEvent[] {
  return db(store)
    .prepare(
      "SELECT * FROM sync_feed WHERE journey=? AND seq>? ORDER BY seq LIMIT ?",
    )
    .all(journey, after, limit)
    .map((r) => ({
      seq: num(r.seq),
      kind: String(r.kind) as FeedKind,
      ids: JSON.parse(String(r.ids)),
      at: num(r.at),
    }));
}

/** Records a Loop event id as applied. Returns false when it was already applied. */
export function markApplied(
  store: Store,
  journey: string,
  eventId: string,
  now = Date.now(),
) {
  return (
    Number(
      db(store)
        .prepare("INSERT OR IGNORE INTO applied_events VALUES(?,?,?)")
        .run(journey, eventId, now).changes,
    ) > 0
  );
}

export function isApplied(store: Store, journey: string, eventId: string) {
  return !!db(store)
    .prepare("SELECT 1 FROM applied_events WHERE journey=? AND event_id=?")
    .get(journey, eventId);
}

const decisionRow = (r: Row): PinDecision => ({
  id: String(r.id),
  pinId: String(r.pin_id),
  status: String(r.status) as PinDecision["status"],
  text: strOrNull(r.text),
  memberId: strOrNull(r.member_id),
  memberName: String(r.member_name),
  at: num(r.at),
  superseded: !!num(r.superseded),
  refused: !!num(r.refused),
});

function currentDecision(store: Store, pinId: string): PinDecision | null {
  const r = db(store)
    .prepare("SELECT * FROM pin_decisions WHERE pin_id=? AND superseded=0")
    .get(pinId);
  return r ? decisionRow(r) : null;
}

/** Every decision on a pin, oldest first, including superseded and refused ones. */
export function pinHistory(store: Store, pinId: string): PinDecision[] {
  return db(store)
    .prepare("SELECT * FROM pin_decisions WHERE pin_id=? ORDER BY n")
    .all(pinId)
    .map(decisionRow);
}

function pinsOf(store: Store, noteId: string): Pin[] {
  return db(store)
    .prepare(
      "SELECT p.*, q.quote, q.proposal FROM pins p LEFT JOIN pin_proposals q ON q.pin_id=p.id WHERE p.note_id=? ORDER BY p.at_ms, p.id",
    )
    .all(noteId)
    .map((r) => ({
      id: String(r.id),
      noteId: String(r.note_id),
      anchor: JSON.parse(String(r.anchor)),
      atMs: num(r.at_ms),
      proposal:
        r.proposal == null
          ? null
          : { quote: String(r.quote), proposal: String(r.proposal) },
      decision: currentDecision(store, String(r.id)),
      requestId: strOrNull(r.request_id),
    }));
}

const noteRow = (store: Store, r: Row): VideoNote => ({
  id: String(r.id),
  journey: String(r.journey),
  versionId: String(r.version_id),
  stepId: String(r.step_id),
  recorderId: strOrNull(r.recorder_id),
  recorderName: String(r.recorder_name),
  mediaId: strOrNull(r.media_id),
  medium: String(r.medium) as VideoNote["medium"],
  status: String(r.status) as VideoNote["status"],
  transcript: strOrNull(r.transcript),
  summary: strOrNull(r.summary),
  contentVersion: num(r.content_version),
  createdAt: num(r.created_at),
  pins: pinsOf(store, String(r.id)),
});

/** A note with its pins, proposals and current decisions; a retracted note is a tombstone. */
export function getNote(store: Store, journey: string, noteId: string) {
  const r = db(store)
    .prepare("SELECT * FROM video_notes WHERE id=? AND journey=?")
    .get(noteId, journey);
  if (!r) throw new Fault(404, "Note not found");
  return noteRow(store, r);
}

export function listNotes(store: Store, journey: string): VideoNote[] {
  return db(store)
    .prepare(
      "SELECT * FROM video_notes WHERE journey=? ORDER BY created_at, rowid",
    )
    .all(journey)
    .map((r) => noteRow(store, r));
}

const isRecorder = (note: VideoNote, actor: Actor) =>
  actor.role === "owner"
    ? note.recorderId == null
    : note.recorderId === actor.memberId;

export function createNote(
  store: Store,
  journey: string,
  raw: unknown,
  actor: Actor,
  now = Date.now(),
): VideoNote {
  const input = noteInputSchema.parse(raw);
  return store.transaction(() => {
    const me = who(store, journey, actor);
    const step = stepOf(store.get(journey), input.versionId, input.stepId);
    for (const p of input.pins) checkAnchor(p.anchor, step);
    if (
      db(store)
        .prepare("SELECT 1 FROM video_notes WHERE media_id=?")
        .get(input.mediaId)
    )
      throw new Fault(409, "This recording already belongs to another note");
    const id = randomUUID();
    db(store)
      .prepare(
        "INSERT INTO video_notes(id,journey,version_id,step_id,recorder_id,recorder_name,media_id,medium,status,content_version,created_at) VALUES(?,?,?,?,?,?,?,?,'unprocessed',1,?)",
      )
      .run(
        id,
        journey,
        input.versionId,
        input.stepId,
        me.id,
        me.name,
        input.mediaId,
        input.medium,
        now,
      );
    for (const p of input.pins) insertPin(store, journey, id, p);
    appendFeed(store, journey, "note", { noteId: id, contentVersion: 1 }, now);
    return getNote(store, journey, id);
  });
}

/**
 * Stores the recorder's Loop processing: transcript, summary and one proposal per pin.
 * A proposal naming an unknown pin creates it (it must carry anchor and atMs).
 * Decided pins keep their proposal. Does not touch the journey blob or its generation.
 */
export function saveProcessing(
  store: Store,
  journey: string,
  noteId: string,
  raw: unknown,
  actor: Actor,
  now = Date.now(),
): VideoNote {
  const input = processingSchema.parse(raw);
  return store.transaction(() => {
    who(store, journey, actor);
    const note = getNote(store, journey, noteId);
    if (note.status === "retracted")
      throw new Fault(409, "This note was retracted");
    if (!isRecorder(note, actor))
      throw new Fault(
        403,
        "Only the note's recorder can save its processing results",
      );
    const step = stepOf(store.get(journey), note.versionId, note.stepId);
    for (const p of input.proposals) {
      const pin = note.pins.find((x) => x.id === p.pinId);
      if (!pin) {
        if (!p.anchor || p.atMs == null)
          throw new Fault(
            400,
            `A new comment needs an anchor and time: ${p.pinId}`,
          );
        checkAnchor(p.anchor, step);
        insertPin(store, journey, noteId, {
          id: p.pinId,
          anchor: p.anchor,
          atMs: p.atMs,
        });
      } else if (pin.decision) continue;
      db(store)
        .prepare(
          "INSERT INTO pin_proposals VALUES(?,?,?) ON CONFLICT(pin_id) DO UPDATE SET quote=excluded.quote, proposal=excluded.proposal",
        )
        .run(p.pinId, p.quote, p.proposal);
    }
    const contentVersion = note.contentVersion + 1;
    db(store)
      .prepare(
        "UPDATE video_notes SET transcript=?, summary=?, status='processed', content_version=? WHERE id=?",
      )
      .run(input.transcript, input.summary, contentVersion, noteId);
    appendFeed(store, journey, "note", { noteId, contentVersion }, now);
    return getNote(store, journey, noteId);
  });
}

/**
 * Compare-and-set on the pin's current decision id (`expected`, null when undecided).
 * A mismatch is stored as a refused row and returns the current decision.
 * A success bumps the journey generation but leaves version approvals alone.
 */
export function decidePin(
  store: Store,
  journey: string,
  pinId: string,
  raw: unknown,
  actor: Actor,
  now = Date.now(),
): DecisionResult {
  const input = decisionInputSchema.parse(raw);
  return store.transaction(() => {
    const me = who(store, journey, actor);
    const r = db(store)
      .prepare(
        "SELECT p.note_id, p.request_id, q.proposal FROM pins p LEFT JOIN pin_proposals q ON q.pin_id=p.id WHERE p.id=? AND p.journey=?",
      )
      .get(pinId, journey);
    if (!r) throw new Fault(404, "Comment not found");
    if (r.request_id != null)
      throw new Fault(
        409,
        "This comment is already in a revision request and can't be decided again",
      );
    let text: string | null = null;
    if (input.status === "approved") {
      if (r.proposal == null)
        throw new Fault(
          409,
          "This comment has no proposed change yet. Change it with your own text or drop it.",
        );
      text = String(r.proposal);
    } else if (input.status === "changed") {
      text = input.text?.trim() ?? "";
      if (!text) throw new Fault(400, "Enter the changed text");
    }
    const current = currentDecision(store, pinId);
    const refused = (current?.id ?? null) !== input.expected;
    const id = randomUUID();
    if (!refused)
      db(store)
        .prepare("UPDATE pin_decisions SET superseded=1 WHERE pin_id=?")
        .run(pinId);
    db(store)
      .prepare(
        "INSERT INTO pin_decisions(id,pin_id,status,text,member_id,member_name,at,superseded,refused) VALUES(?,?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        pinId,
        input.status,
        text,
        me.id,
        me.name,
        now,
        refused ? 1 : 0,
        refused ? 1 : 0,
      );
    if (refused) return { ok: false, current };
    store.mutate(journey, (j) => {
      j.generation++;
    });
    appendFeed(
      store,
      journey,
      "decision",
      { pinId, decisionId: id, noteId: String(r.note_id) },
      now,
    );
    return { ok: true, decision: currentDecision(store, pinId)! };
  });
}

const EXCERPT_WINDOW_MS = 5000;
const EXCERPT_MAX = 1000;
/**
 * The recorded words around `atMs`. A transcript stored as JSON `[{startMs, endMs, text}]`
 * segments yields the segments within 5 seconds of the pin (or the nearest one); plain text
 * has no timing, so it yields null.
 */
export function transcriptExcerpt(
  transcript: string | null,
  atMs: number,
): string | null {
  if (!transcript) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(transcript);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const segments = parsed.filter(
    (s): s is { startMs: number; endMs: number; text: string } =>
      !!s &&
      typeof s.startMs === "number" &&
      typeof s.endMs === "number" &&
      typeof s.text === "string",
  );
  if (!segments.length) return null;
  let near = segments.filter(
    (s) =>
      s.endMs >= atMs - EXCERPT_WINDOW_MS &&
      s.startMs <= atMs + EXCERPT_WINDOW_MS,
  );
  if (!near.length) {
    const gap = (s: (typeof segments)[number]) =>
      Math.min(Math.abs(s.startMs - atMs), Math.abs(s.endMs - atMs));
    near = [segments.reduce((a, b) => (gap(b) < gap(a) ? b : a))];
  }
  const text = near
    .map((s) => s.text.trim())
    .filter(Boolean)
    .join(" ");
  if (!text) return null;
  return text.length > EXCERPT_MAX ? `${text.slice(0, EXCERPT_MAX)}…` : text;
}

/**
 * Called inside `Store.request`: takes every decided pin of the journey that no earlier
 * request consumed. Approved and changed pins become request items; dropped pins resolve;
 * undecided pins stay open.
 */
export function consumeDecidedPins(
  store: Store,
  journey: string,
  requestId: string,
): RequestPin[] {
  const items: RequestPin[] = [];
  for (const note of listNotes(store, journey)) {
    for (const p of note.pins) {
      if (p.requestId || !p.decision) continue;
      db(store)
        .prepare("UPDATE pins SET request_id=? WHERE id=?")
        .run(requestId, p.id);
      if (p.decision.status === "dropped") continue;
      items.push({
        pinId: p.id,
        noteId: note.id,
        versionId: note.versionId,
        stepId: note.stepId,
        anchor: p.anchor,
        atMs: p.atMs,
        quote: p.proposal?.quote ?? null,
        proposal: p.proposal?.proposal ?? null,
        status: p.decision.status,
        text: p.decision.text!,
        decisionId: p.decision.id,
        decidedBy: {
          memberId: p.decision.memberId,
          name: p.decision.memberName,
        },
        decidedAt: p.decision.at,
        transcriptExcerpt: transcriptExcerpt(note.transcript, p.atMs),
      });
    }
  }
  return items;
}

/**
 * Retracts a note (recorder or owner only): deletes its pins and their decisions, clears
 * transcript, summary and media, and removes its pins from open request snapshots.
 * Returns the media id the caller should delete. Repeating it changes nothing.
 */
export function retractNote(
  store: Store,
  journey: string,
  noteId: string,
  actor: Actor,
  now = Date.now(),
): { note: VideoNote; mediaId: string | null } {
  return store.transaction(() => {
    who(store, journey, actor);
    const note = getNote(store, journey, noteId);
    if (actor.role !== "owner" && note.recorderId !== actor.memberId)
      throw new Fault(403, "Only the recorder or the owner can retract a note");
    if (note.status === "retracted") return { note, mediaId: null };
    db(store).prepare("DELETE FROM pins WHERE note_id=?").run(noteId);
    const contentVersion = note.contentVersion + 1;
    db(store)
      .prepare(
        "UPDATE video_notes SET status='retracted', transcript=NULL, summary=NULL, media_id=NULL, content_version=? WHERE id=?",
      )
      .run(contentVersion, noteId);
    const j = store.get(journey);
    let redacted = false;
    for (const q of j.requests)
      if (!q.successorId && q.pins?.some((p) => p.noteId === noteId)) {
        q.pins = q.pins.filter((p) => p.noteId !== noteId);
        redacted = true;
      }
    if (redacted) {
      j.generation++;
      store.save(j);
    }
    appendFeed(store, journey, "note", { noteId, contentVersion }, now);
    return { note: getNote(store, journey, noteId), mediaId: note.mediaId };
  });
}

const turnRow = (r: Row): Turn => ({
  id: String(r.id),
  journey: String(r.journey),
  loopTurnId: String(r.loop_turn_id),
  parentIds: JSON.parse(String(r.parent_ids)),
  inputs: JSON.parse(String(r.inputs)),
  outputs: JSON.parse(String(r.outputs)),
  reactionNoteIds: JSON.parse(String(r.reaction_note_ids)),
  versionId: strOrNull(r.version_id),
  notAVersionReason: strOrNull(r.not_version_reason),
  authorId: strOrNull(r.author_id),
  authorName: String(r.author_name),
  at: num(r.at),
});

export function recordTurn(
  store: Store,
  journey: string,
  raw: unknown,
  actor: Actor,
  now = Date.now(),
): Turn {
  const t = turnInputSchema.parse(raw);
  return store.transaction(() => {
    const me = who(store, journey, actor);
    if (
      t.versionId &&
      !store.get(journey).versions.some((v) => v.id === t.versionId)
    )
      throw new Fault(400, "Round names a version outside this journey");
    if (
      db(store)
        .prepare("SELECT 1 FROM turns WHERE journey=? AND loop_turn_id=?")
        .get(journey, t.loopTurnId)
    )
      throw new Fault(409, "This round was already recorded");
    const id = randomUUID();
    db(store)
      .prepare(
        "INSERT INTO turns(id,journey,loop_turn_id,parent_ids,inputs,outputs,reaction_note_ids,version_id,not_version_reason,author_id,author_name,at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        journey,
        t.loopTurnId,
        JSON.stringify(t.parentIds),
        JSON.stringify(t.inputs),
        JSON.stringify(t.outputs),
        JSON.stringify(t.reactionNoteIds),
        t.versionId,
        t.notAVersionReason,
        me.id,
        me.name,
        now,
      );
    appendFeed(store, journey, "turn", { turnId: id }, now);
    return turnRow(
      db(store).prepare("SELECT * FROM turns WHERE id=?").get(id)!,
    );
  });
}

export function listTurns(store: Store, journey: string): Turn[] {
  return db(store)
    .prepare("SELECT * FROM turns WHERE journey=? ORDER BY n")
    .all(journey)
    .map(turnRow);
}

const shelfRow = (r: Row): ShelfItem => ({
  id: String(r.id),
  journey: String(r.journey),
  itemId: String(r.item_id),
  reason: String(r.reason),
  memberId: strOrNull(r.member_id),
  memberName: String(r.member_name),
  at: num(r.at),
});

/** Puts an item on the journey's shelf; shelving it again updates the reason. */
export function shelve(
  store: Store,
  journey: string,
  raw: unknown,
  actor: Actor,
  now = Date.now(),
): ShelfItem {
  const s = shelfInputSchema.parse(raw);
  return store.transaction(() => {
    const me = who(store, journey, actor);
    store.get(journey);
    db(store)
      .prepare(
        "INSERT INTO shelf(id,journey,item_id,reason,member_id,member_name,at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(journey,item_id) DO UPDATE SET reason=excluded.reason, member_id=excluded.member_id, member_name=excluded.member_name, at=excluded.at",
      )
      .run(randomUUID(), journey, s.itemId, s.reason, me.id, me.name, now);
    const row = shelfRow(
      db(store)
        .prepare("SELECT * FROM shelf WHERE journey=? AND item_id=?")
        .get(journey, s.itemId)!,
    );
    appendFeed(store, journey, "shelf", { shelfId: row.id }, now);
    return row;
  });
}

export function listShelf(store: Store, journey: string): ShelfItem[] {
  return db(store)
    .prepare("SELECT * FROM shelf WHERE journey=? ORDER BY n")
    .all(journey)
    .map(shelfRow);
}
