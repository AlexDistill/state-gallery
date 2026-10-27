import { createHash, randomUUID } from "node:crypto";
import {
  createWriteStream,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { validateRaster } from "../shared/raster.js";
import { Fault, type Store } from "./domain.js";

export const MEDIA_LIMIT = 500 * 1024 * 1024;
/** Uploads no committed note references are removed after this long. */
export const MEDIA_UNREFERENCED_LIFETIME = 86400000;
const RECORDING_TYPES = ["audio/webm", "audio/mp4", "video/webm", "video/mp4"];
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];

export interface Media {
  id: string;
  journey: string;
  sha256: string;
  mime: string;
  size: number;
  /** Relative to the media directory. */
  path: string;
  uploader: string;
  uploadedAt: number;
  /** Member id of the only person who may read it (an unprocessed recording), or null. */
  restrictedTo: string | null;
  referencedAt: number | null;
  width: number | null;
  height: number | null;
}

const ready = new WeakSet<Store>();
function table(store: Store) {
  if (ready.has(store)) return store.db;
  store.db.exec(
    `CREATE TABLE IF NOT EXISTS media(id TEXT PRIMARY KEY,journey TEXT NOT NULL,sha256 TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,path TEXT NOT NULL,uploader TEXT NOT NULL,uploaded_at INTEGER NOT NULL,restricted_to TEXT,referenced_at INTEGER,width INTEGER,height INTEGER,UNIQUE(journey,sha256));`,
  );
  ready.add(store);
  return store.db;
}
const row = (r: Record<string, unknown>): Media => ({
  id: String(r.id),
  journey: String(r.journey),
  sha256: String(r.sha256),
  mime: String(r.mime),
  size: Number(r.size),
  path: String(r.path),
  uploader: String(r.uploader),
  uploadedAt: Number(r.uploaded_at),
  restrictedTo: r.restricted_to == null ? null : String(r.restricted_to),
  referencedAt: r.referenced_at == null ? null : Number(r.referenced_at),
  width: r.width == null ? null : Number(r.width),
  height: r.height == null ? null : Number(r.height),
});

/** `media/` beside the SQLite file, or a temp folder for an in-memory store. */
export function defaultMediaDir(store: Store) {
  const r = store.db
    .prepare("SELECT file FROM pragma_database_list WHERE name='main'")
    .get();
  const file = r?.file ? String(r.file) : "";
  return file
    ? join(dirname(file), "media")
    : join(tmpdir(), `state-gallery-media-${process.pid}`);
}

export function getMedia(store: Store, id: string): Media | null {
  const r = table(store).prepare("SELECT * FROM media WHERE id=?").get(id);
  return r ? row(r) : null;
}

/** Mark raw media as an unprocessed note's recording (readable only by `recorder`), or clear it with null. */
export function setMediaRestricted(
  store: Store,
  mediaId: string,
  recorder: string | null,
) {
  const r = table(store)
    .prepare("UPDATE media SET restricted_to=? WHERE id=?")
    .run(recorder, mediaId);
  if (!r.changes) throw new Fault(404, "Media not found");
}

/** Record that a committed note references this media, so the sweep keeps it. */
export function referenceMedia(
  store: Store,
  mediaId: string,
  now = Date.now(),
) {
  const r = table(store)
    .prepare(
      "UPDATE media SET referenced_at=COALESCE(referenced_at,?) WHERE id=?",
    )
    .run(now, mediaId);
  if (!r.changes) throw new Fault(404, "Media not found");
}

/** Delete uploads no committed note references once they are older than a day; returns the removed ids. */
export function sweepMedia(store: Store, dir: string, now = Date.now()) {
  const db = table(store);
  const cutoff = now - MEDIA_UNREFERENCED_LIFETIME;
  const stale = db
    .prepare(
      "SELECT * FROM media WHERE referenced_at IS NULL AND uploaded_at<=?",
    )
    .all(cutoff)
    .map(row);
  for (const m of stale) {
    db.prepare("DELETE FROM media WHERE id=?").run(m.id);
    rmSync(join(dir, m.path), { force: true });
  }
  // Partial files left by a crash mid-upload.
  const tmp = join(dir, "tmp");
  try {
    for (const name of readdirSync(tmp)) {
      const p = join(tmp, name);
      if (statSync(p).mtimeMs <= cutoff) rmSync(p, { force: true });
    }
  } catch {
    // No temp folder yet.
  }
  return stale.map((m) => m.id);
}

/** Lower-cased base type of a Content-Type header, without parameters such as codecs. */
export const baseMime = (header: string | undefined) =>
  String(header ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();

const tooLarge = () => new Fault(413, "Media must be 500 MB or smaller");

/**
 * Streams an upload to a temp file, then keeps one file per journey and sha256.
 * Returns the stored media and whether it already existed.
 */
export async function saveUpload(
  store: Store,
  dir: string,
  input: {
    journey: string;
    uploader: string;
    contentType: string | undefined;
    contentLength: string | undefined;
    body: Readable;
  },
  limit = MEDIA_LIMIT,
): Promise<{ media: Media; existing: boolean }> {
  const db = table(store);
  let mime = baseMime(input.contentType);
  if (!RECORDING_TYPES.includes(mime) && !IMAGE_TYPES.includes(mime))
    throw new Fault(
      415,
      "Upload audio or video as WebM or MP4, or an image as PNG, JPEG or WebP",
    );
  if (input.contentLength && Number(input.contentLength) > limit)
    throw tooLarge();
  mkdirSync(join(dir, "tmp"), { recursive: true, mode: 0o700 });
  const tmp = join(dir, "tmp", randomUUID());
  const hash = createHash("sha256");
  let size = 0;
  try {
    await pipeline(
      input.body,
      new Transform({
        transform(chunk: Buffer, _enc, done) {
          size += chunk.length;
          if (size > limit) return done(tooLarge());
          hash.update(chunk);
          done(null, chunk);
        },
      }),
      createWriteStream(tmp, { mode: 0o600 }),
    );
    if (!size) throw new Fault(400, "The upload is empty");
    let width: number | null = null;
    let height: number | null = null;
    if (IMAGE_TYPES.includes(mime)) {
      if (size > 10 * 1024 * 1024)
        throw new Fault(400, "Images must be under 10 MB each");
      try {
        const r = await validateRaster(readFileSync(tmp));
        ({ mime, width, height } = r);
      } catch (e) {
        throw new Fault(400, (e as Error).message);
      }
    }
    const sha256 = hash.digest("hex");
    const now = Date.now();
    const found = db
      .prepare("SELECT * FROM media WHERE journey=? AND sha256=?")
      .get(input.journey, sha256);
    if (found) {
      // A repeat upload restarts the unreferenced clock so a pending push can still name it.
      db.prepare("UPDATE media SET uploaded_at=? WHERE id=?").run(
        now,
        String(found.id),
      );
      return { media: getMedia(store, String(found.id))!, existing: true };
    }
    const path = join("files", input.journey, sha256);
    mkdirSync(join(dir, "files", input.journey), {
      recursive: true,
      mode: 0o700,
    });
    renameSync(tmp, join(dir, path));
    const id = randomUUID();
    db.prepare(
      "INSERT INTO media(id,journey,sha256,mime,size,path,uploader,uploaded_at,width,height) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(journey,sha256) DO NOTHING",
    ).run(
      id,
      input.journey,
      sha256,
      mime,
      size,
      path,
      input.uploader,
      now,
      width,
      height,
    );
    const stored = db
      .prepare("SELECT * FROM media WHERE journey=? AND sha256=?")
      .get(input.journey, sha256)!;
    return { media: row(stored), existing: String(stored.id) !== id };
  } finally {
    rmSync(tmp, { force: true });
  }
}
