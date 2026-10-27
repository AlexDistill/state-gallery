import { randomUUID } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { Fault, type Store } from "./domain.js";
import {
  getMedia,
  referenceMedia,
  uploadedBy,
  setMediaRestricted,
  sweepMedia,
  type Media,
} from "./media.js";
import {
  createNote,
  closedPin,
  decidePin,
  feedSince,
  getNote,
  isApplied,
  latestSeq,
  listNotes,
  listShelf,
  listTurns,
  markApplied,
  recordTurn,
  retractNote,
  saveProcessing,
  shelve,
  type Actor,
} from "./notes.js";
import {
  decisionInputSchema,
  noteInputSchema,
  pinInputSchema,
  processingSchema,
  shelfInputSchema,
  turnInputSchema,
} from "../shared/schema.js";
import type { FeedEvent, Journey, VideoNote } from "../shared/model.js";

const SYNC_SCHEMA = `
CREATE TABLE IF NOT EXISTS loop_links(member_id TEXT PRIMARY KEY,journey TEXT NOT NULL,seed_id TEXT NOT NULL,bed TEXT NOT NULL,linked_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS journey_sync(journey TEXT PRIMARY KEY,confidential INTEGER NOT NULL,changed_by TEXT NOT NULL,changed_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS note_files(id TEXT PRIMARY KEY,note_id TEXT NOT NULL REFERENCES video_notes(id) ON DELETE CASCADE,journey TEXT NOT NULL,name TEXT NOT NULL,media_id TEXT,text TEXT,UNIQUE(note_id,name));
CREATE INDEX IF NOT EXISTS note_files_media ON note_files(media_id);
CREATE TABLE IF NOT EXISTS push_results(journey TEXT NOT NULL,event_id TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(journey,event_id));
`;
const ready = new WeakSet<Store>();
function db(store: Store) {
  if (!ready.has(store)) {
    store.db.exec(SYNC_SCHEMA);
    ready.add(store);
  }
  return store.db;
}

const id = z.string().regex(/^[\w.:-]{1,200}$/);
const ref = z.string().min(1).max(200);
const linkSchema = z.object({
  seedId: id,
  bed: z
    .string()
    .regex(
      /^shared:.{1,200}$/,
      "Only a shared: workspace can link to the gallery",
    ),
  confidential: z.boolean(),
});
/**
 * Folder files a push may carry. Binary ones name uploaded media; text ones carry their text.
 * Loop names key frames by millisecond offset (up to 86 400 000, a day) and the marked
 * version image `frames/version.png`.
 */
const FILE_NAME =
  /^(recording|audio|transcript|readback|pins|pointer|frames\/(\d{1,8}\.(png|jpg)|version\.png))$/;
const TEXT_FILES = new Set(["transcript", "readback", "pins", "pointer"]);
/** The pointer track a gallery recording carries: positions on the image, timed from recorder start. */
const pointerSchema = z
  .array(
    z.object({
      t: z.number().int().min(0).max(86_400_000),
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
    }),
  )
  .max(200_000);
const fileSchema = z.object({
  name: z.string().max(200),
  mediaId: ref.optional(),
  text: z.string().max(2_000_000).optional(),
});
type FileInput = z.infer<typeof fileSchema>;
const eventId = id;
export const pushSchema = z.object({
  link: linkSchema,
  notes: z
    .array(
      z.object({
        eventId,
        versionId: ref,
        stepId: z.string().min(1).max(100),
        medium: z.enum(["audio", "video"]),
        pins: z.array(pinInputSchema).max(500),
        files: z.array(fileSchema).max(1000),
        processing: processingSchema.optional(),
      }),
    )
    .max(500)
    .default([]),
  processing: z
    .array(
      processingSchema.extend({
        eventId,
        noteId: ref,
        files: z.array(fileSchema).max(1000).default([]),
      }),
    )
    .max(500)
    .default([]),
  decisions: z
    .array(decisionInputSchema.extend({ eventId, pinId: id }))
    .max(2000)
    .default([]),
  turns: z
    .array(
      turnInputSchema
        .omit({ versionId: true, notAVersionReason: true })
        .extend({
          eventId,
          parentVersionId: ref.nullable(),
          requestId: ref.optional(),
          responses: z.record(z.string(), z.string().max(4000)).default({}),
          version: z
            .looseObject({
              steps: z
                .array(z.looseObject({ image: ref.optional() }))
                .min(1)
                .max(2000),
            })
            .optional(),
        }),
    )
    .max(500)
    .default([]),
  shelf: z.array(shelfInputSchema.extend({ eventId })).max(2000).default([]),
  retractions: z
    .array(z.object({ eventId, noteId: ref }))
    .max(500)
    .default([]),
});

export type NoteFile = {
  id: string;
  name: string;
  mediaId: string | null;
  text?: string | null;
};
export type NoteView = VideoNote & { files: NoteFile[] };

export function isConfidential(store: Store, journey: string) {
  const r = db(store)
    .prepare("SELECT confidential FROM journey_sync WHERE journey=?")
    .get(journey);
  return !!r && !!Number(r.confidential);
}

/** Sets the journey's confidential flag: from the seed on link and push, or by the owner in the gallery. */
export function setConfidential(
  store: Store,
  journey: string,
  confidential: boolean,
  by: string,
  now = Date.now(),
) {
  store.get(journey);
  db(store)
    .prepare(
      "INSERT INTO journey_sync VALUES(?,?,?,?) ON CONFLICT(journey) DO UPDATE SET confidential=excluded.confidential, changed_by=excluded.changed_by, changed_at=excluded.changed_at",
    )
    .run(journey, confidential ? 1 : 0, by, now);
  return { confidential };
}

/** Binds the member's Loop seed and `shared:` bed to the journey and records the seed's confidential state. */
export function link(
  store: Store,
  journey: string,
  memberId: string,
  raw: unknown,
  now = Date.now(),
) {
  const l = linkSchema.parse(raw);
  return store.transaction(() => {
    store.get(journey);
    db(store)
      .prepare(
        "INSERT INTO loop_links VALUES(?,?,?,?,?) ON CONFLICT(member_id) DO UPDATE SET seed_id=excluded.seed_id, bed=excluded.bed",
      )
      .run(memberId, journey, l.seedId, l.bed, now);
    // A member's seed may raise the flag, but only the member who raised it
    // (or the owner, from the gallery) may clear it.
    const current = db(store)
      .prepare(
        "SELECT confidential, changed_by FROM journey_sync WHERE journey=?",
      )
      .get(journey);
    const raised = !!current && !!Number(current.confidential);
    // Re-raising a held flag keeps the original raiser, so nobody can take
    // it over and then clear it.
    if (l.confidential ? !raised : !raised || current.changed_by === memberId)
      setConfidential(store, journey, l.confidential, memberId, now);
    const g = store.markLinkedLoop(memberId, now)!;
    return {
      seedId: l.seedId,
      bed: l.bed,
      confidential: l.confidential,
      linkedLoopAt: g.linkedLoopAt,
    };
  });
}

/** Media a member may attach: uploaded to this journey by that member (first or as a repeat), of the expected kind. */
function ownMedia(
  store: Store,
  journey: string,
  memberId: string,
  mediaId: string,
  kind: "recording" | "image/png" | "image/jpeg" | "image",
): Media {
  const m = getMedia(store, mediaId);
  if (!m || m.journey !== journey)
    throw new Fault(
      400,
      `Media ${mediaId} is not uploaded to this journey. Upload it, then share with the team again.`,
    );
  if (!uploadedBy(store, m.id, memberId))
    throw new Fault(403, `Media ${mediaId} was uploaded by another member`);
  const ok =
    kind === "recording"
      ? /^(audio|video)\//.test(m.mime)
      : kind === "image"
        ? m.mime.startsWith("image/")
        : m.mime === kind;
  if (!ok) throw new Fault(400, `Media ${mediaId} is ${m.mime}, not ${kind}`);
  return m;
}

function noteFiles(store: Store, noteId: string, withText: boolean) {
  return db(store)
    .prepare("SELECT * FROM note_files WHERE note_id=? ORDER BY name")
    .all(noteId)
    .map((r) => ({
      id: String(r.id),
      name: String(r.name),
      mediaId: r.media_id == null ? null : String(r.media_id),
      ...(withText ? { text: r.text == null ? null : String(r.text) } : {}),
    }));
}

/** A note as `viewer` may see it: an unprocessed note's media only for its recorder. */
export function noteView(
  store: Store,
  note: VideoNote,
  viewer: string | null,
  withText = false,
): NoteView {
  const hidden =
    note.status === "unprocessed" &&
    (viewer == null || note.recorderId !== viewer);
  return {
    ...note,
    mediaId: hidden ? null : note.mediaId,
    files: hidden ? [] : noteFiles(store, note.id, withText),
  };
}

/** Raw media of an unprocessed note is readable only by its recorder; processed media by every member. */
function applyRestriction(store: Store, note: VideoNote) {
  const to = note.status === "unprocessed" ? note.recorderId : null;
  const ids = new Set(
    [note.mediaId, ...noteFiles(store, note.id, false).map((f) => f.mediaId)]
      .filter((x): x is string => !!x)
      .filter((x) => getMedia(store, x)),
  );
  for (const m of ids) setMediaRestricted(store, m, to);
}

function putFiles(
  store: Store,
  journey: string,
  memberId: string,
  noteId: string,
  files: FileInput[],
  now: number,
) {
  for (const f of files) {
    if (!FILE_NAME.test(f.name))
      throw new Fault(
        400,
        `Folder file name not allowed: ${JSON.stringify(f.name)}`,
      );
    if (TEXT_FILES.has(f.name)) {
      if (f.text == null || f.mediaId)
        throw new Fault(400, `${f.name} is sent as text`);
    } else {
      if (!f.mediaId || f.text != null)
        throw new Fault(400, `${f.name} is sent as an uploaded media id`);
      ownMedia(
        store,
        journey,
        memberId,
        f.mediaId,
        f.name.endsWith(".png")
          ? "image/png"
          : f.name.endsWith(".jpg")
            ? "image/jpeg"
            : "recording",
      );
      referenceMedia(store, f.mediaId, now);
    }
    db(store)
      .prepare(
        "INSERT INTO note_files VALUES(?,?,?,?,?,?) ON CONFLICT(note_id,name) DO UPDATE SET media_id=excluded.media_id, text=excluded.text",
      )
      .run(
        randomUUID(),
        noteId,
        journey,
        f.name,
        f.mediaId ?? null,
        f.text ?? null,
      );
  }
}

/** Records a gallery recording (browser). The recorder needs a linked Loop; a confidential link refuses it. */
export function createGalleryNote(
  store: Store,
  journey: string,
  memberId: string,
  raw: unknown,
  now = Date.now(),
): NoteView {
  return store.transaction(() => {
    if (!store.memberGrant(memberId)?.linkedLoopAt)
      throw new Fault(
        409,
        "Link your Loop to this journey before recording: only your Loop can process your recording.",
      );
    if (isConfidential(store, journey))
      throw new Fault(
        409,
        "This project is marked confidential, so recording is off: recordings are shared with the team.",
      );
    const input = noteInputSchema.parse(raw);
    const pointer = pointerSchema
      .optional()
      .parse((raw as { pointer?: unknown } | null)?.pointer);
    ownMedia(store, journey, memberId, input.mediaId, "recording");
    const note = createNote(
      store,
      journey,
      input,
      { role: "member", memberId },
      now,
    );
    referenceMedia(store, input.mediaId, now);
    if (pointer)
      putFiles(
        store,
        journey,
        memberId,
        note.id,
        [{ name: "pointer", text: JSON.stringify(pointer) }],
        now,
      );
    applyRestriction(store, note);
    return noteView(store, note, memberId);
  });
}

/**
 * Retracts a note and returns the media file paths to delete once the transaction commits:
 * only media of this note and journey that no other note references.
 */
function retract(
  store: Store,
  journey: string,
  noteId: string,
  actor: Actor,
  now: number,
) {
  const fileMedia = noteFiles(store, noteId, false).map((f) => f.mediaId);
  const { note, mediaId } = retractNote(store, journey, noteId, actor, now);
  db(store).prepare("DELETE FROM note_files WHERE note_id=?").run(noteId);
  const paths: string[] = [];
  for (const m of new Set([mediaId, ...fileMedia])) {
    if (!m) continue;
    const media = getMedia(store, m);
    if (!media || media.journey !== journey) continue;
    const used =
      db(store).prepare("SELECT 1 FROM video_notes WHERE media_id=?").get(m) ||
      db(store).prepare("SELECT 1 FROM note_files WHERE media_id=?").get(m);
    if (used) continue;
    db(store).prepare("DELETE FROM media WHERE id=?").run(m);
    paths.push(media.path);
  }
  return { note, paths };
}

const removeFiles = (dir: string, paths: string[]) => {
  for (const p of paths) rmSync(join(dir, p), { force: true });
};

export function discardNote(
  store: Store,
  journey: string,
  noteId: string,
  mediaDir: string,
  now = Date.now(),
): NoteView {
  const { note, paths } = store.transaction(() => {
    if (getNote(store, journey, noteId).status !== "unprocessed")
      throw new Fault(
        409,
        "Only a recording still waiting for its recorder's Loop can be discarded",
      );
    return retract(store, journey, noteId, { role: "owner" }, now);
  });
  removeFiles(mediaDir, paths);
  return noteView(store, note, null);
}

function openRequestFor(j: Journey, requestId: string) {
  const q = j.requests.find((q) => q.id === requestId);
  if (!q) throw new Fault(400, `Revision request not found: ${requestId}`);
  return (
    q.id === j.requests.at(-1)?.id &&
    q.versionId === j.currentId &&
    !q.successorId
  );
}

/**
 * Drops responses to comments that are no longer anywhere in the journey: a retraction
 * removes its pins from the open request while a round answering it may already be built.
 * A response naming feedback that still exists outside the request is kept, so the
 * request check still refuses it.
 */
function withoutRetracted(
  store: Store,
  j: Journey,
  requestId: string | undefined,
  responses: Record<string, string>,
) {
  const q = j.requests.find((q) => q.id === requestId);
  const exists = (id: string) =>
    !!q?.comments.some((c) => c.id === id) ||
    !!q?.pins?.some((p) => p.pinId === id) ||
    j.comments.some((c) => c.id === id) ||
    !!db(store)
      .prepare("SELECT 1 FROM pins WHERE id=? AND journey=?")
      .get(id, j.id);
  return Object.fromEntries(
    Object.entries(responses).filter(([id]) => exists(id)),
  );
}

type PushTurn = z.infer<typeof pushSchema>["turns"][number];
function applyTurn(
  store: Store,
  journey: string,
  memberId: string,
  t: PushTurn,
  mediaDir: string,
  now: number,
) {
  let versionId: string | null = null;
  let reason: string | null = null;
  if (t.outputs.some((o) => o.kind === "image")) {
    if (!t.version)
      throw new Fault(
        400,
        "A round with image outputs needs its version steps",
      );
    const j = store.get(journey);
    if ((j.currentId ?? null) !== t.parentVersionId)
      reason =
        "Another version was added from the same parent first. Get the latest from the gallery, then redo this round from the latest version.";
    else if (t.requestId && !openRequestFor(j, t.requestId))
      reason =
        "The revision request this round answers was replaced. Get the latest from the gallery, then redo it from the latest request.";
    else {
      const assets: Record<
        string,
        { bytes: Buffer; mime: string; width: number; height: number }
      > = Object.create(null);
      for (const s of t.version.steps) {
        if (!s.image) continue;
        const m = ownMedia(store, journey, memberId, s.image, "image");
        let bytes: Buffer;
        try {
          bytes = readFileSync(join(mediaDir, m.path));
        } catch {
          throw new Fault(
            400,
            `Media ${m.id} is not uploaded to this journey. Upload it, then share with the team again.`,
          );
        }
        assets[m.id] = {
          bytes,
          mime: m.mime,
          width: m.width!,
          height: m.height!,
        };
      }
      const v = store.submit(
        journey,
        {
          ...t.version,
          schemaVersion: 1,
          parentId: t.parentVersionId ?? undefined,
          requestId: t.requestId,
          responses: withoutRetracted(store, j, t.requestId, t.responses),
        },
        assets,
        `loop-turn:${t.loopTurnId}`,
      );
      versionId = v.id;
    }
  } else if (t.version)
    throw new Fault(400, "Version steps need an image output on the round");
  const turn = recordTurn(
    store,
    journey,
    {
      loopTurnId: t.loopTurnId,
      parentIds: t.parentIds,
      inputs: t.inputs,
      outputs: t.outputs,
      reactionNoteIds: t.reactionNoteIds,
      versionId,
      notAVersionReason: reason,
    },
    { role: "member", memberId },
    now,
  );
  return { turnId: turn.id, versionId, notAVersionReason: reason };
}

/**
 * Applies one Loop push as one transaction, in order: link state, notes and processing,
 * decisions, turns and versions, shelf, retractions. Identities come from `memberId`;
 * already-applied event ids return their stored result. Any failure rolls back the whole push.
 */
export function push(
  store: Store,
  journey: string,
  memberId: string,
  raw: unknown,
  mediaDir: string,
  now = Date.now(),
) {
  const p = pushSchema.parse(raw);
  const actor: Actor = { role: "member", memberId };
  const deleted: string[] = [];
  const out = store.transaction(() => {
    const linked = link(store, journey, memberId, p.link, now);
    const results: Record<string, unknown>[] = [];
    const apply = (
      eventId: string,
      kind: string,
      fn: () => Record<string, unknown>,
    ) => {
      if (isApplied(store, journey, eventId)) {
        const r = db(store)
          .prepare(
            "SELECT result FROM push_results WHERE journey=? AND event_id=?",
          )
          .get(journey, eventId);
        results.push(r ? JSON.parse(String(r.result)) : { eventId, kind });
        return;
      }
      const r = { eventId, kind, ...fn() };
      markApplied(store, journey, eventId, now);
      db(store)
        .prepare("INSERT INTO push_results VALUES(?,?,?)")
        .run(journey, eventId, JSON.stringify(r));
      results.push(r);
    };
    const open = () => {
      if (linked.confidential || isConfidential(store, journey))
        throw new Fault(
          409,
          "This project is confidential, so only decisions and retractions can be shared with the team",
        );
    };
    for (const n of p.notes)
      apply(n.eventId, "note", () => {
        open();
        const own = n.medium === "video" ? "recording" : "audio";
        const rec = n.files.find((f) => f.name === own)?.mediaId;
        if (!rec)
          throw new Fault(400, `A ${n.medium} note needs its ${own} file`);
        ownMedia(store, journey, memberId, rec, "recording");
        const note = createNote(
          store,
          journey,
          {
            versionId: n.versionId,
            stepId: n.stepId,
            mediaId: rec,
            medium: n.medium,
            pins: n.pins,
          },
          actor,
          now,
        );
        putFiles(store, journey, memberId, note.id, n.files, now);
        if (n.processing)
          saveProcessing(store, journey, note.id, n.processing, actor, now);
        const saved = getNote(store, journey, note.id);
        applyRestriction(store, saved);
        return { noteId: note.id, contentVersion: saved.contentVersion };
      });
    for (const x of p.processing)
      apply(x.eventId, "processing", () => {
        open();
        putFiles(store, journey, memberId, x.noteId, x.files, now);
        const note = saveProcessing(store, journey, x.noteId, x, actor, now);
        applyRestriction(store, note);
        return { noteId: note.id, contentVersion: note.contentVersion };
      });
    for (const d of p.decisions)
      apply(d.eventId, "decision", () => {
        const closed = closedPin(store, journey, d.pinId);
        if (closed) return { pinId: d.pinId, ok: false, ...closed };
        const r = decidePin(store, journey, d.pinId, d, actor, now);
        return r.ok
          ? { pinId: d.pinId, ok: true, decision: r.decision }
          : { pinId: d.pinId, ok: false, current: r.current };
      });
    for (const t of p.turns)
      apply(t.eventId, "turn", () => {
        open();
        return applyTurn(store, journey, memberId, t, mediaDir, now);
      });
    for (const s of p.shelf)
      apply(s.eventId, "shelf", () => {
        open();
        return { shelfId: shelve(store, journey, s, actor, now).id };
      });
    for (const r of p.retractions)
      apply(r.eventId, "retraction", () => {
        const { note, paths } = retract(store, journey, r.noteId, actor, now);
        deleted.push(...paths);
        return { noteId: note.id, contentVersion: note.contentVersion };
      });
    return { link: linked, results };
  });
  removeFiles(mediaDir, deleted);
  sweepMedia(store, mediaDir, now);
  return { ...out, latestSeq: latestSeq(store, journey) };
}

/**
 * The journey's feed after `after` as `memberId` sees it: a note still waiting for processing
 * appears only to its recorder, with its raw media id. `next` is the seq to ask after next time.
 */
export function memberFeed(
  store: Store,
  journey: string,
  memberId: string,
  after: number,
  limit = 500,
) {
  const all = feedSince(store, journey, after, limit);
  const events: FeedEvent[] = [];
  for (const e of all) {
    if (e.kind === "note") {
      const note = getNote(store, journey, String(e.ids.noteId));
      if (note.status === "unprocessed") {
        if (note.recorderId !== memberId) continue;
        events.push({ ...e, ids: { ...e.ids, mediaId: note.mediaId! } });
        continue;
      }
    }
    events.push(e);
  }
  return {
    events,
    next: all.at(-1)?.seq ?? after,
    latestSeq: latestSeq(store, journey),
  };
}

/** Current content for ids named by feed events; a retracted note is a tombstone. */
export function syncContent(
  store: Store,
  journey: string,
  memberId: string,
  ids: {
    notes: string[];
    turns: string[];
    shelf: string[];
    versions: string[];
    requests: string[];
  },
) {
  const j = store.get(journey);
  const has = (list: string[]) => {
    const s = new Set(list);
    return (x: { id: string }) => s.has(x.id);
  };
  return {
    notes: listNotes(store, journey)
      .filter(has(ids.notes))
      .map((n) => noteView(store, n, memberId, true)),
    turns: listTurns(store, journey).filter(has(ids.turns)),
    shelf: listShelf(store, journey).filter(has(ids.shelf)),
    versions: j.versions.filter(has(ids.versions)),
    requests: j.requests.filter(has(ids.requests)),
  };
}
