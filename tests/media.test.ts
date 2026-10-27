import { test } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, readdirSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "../src/server/http.js";
import { Store } from "../src/server/domain.js";
import { Readable } from "node:stream";
import {
  getMedia,
  saveUpload,
  referenceMedia,
  setMediaRestricted,
  sweepMedia,
} from "../src/server/media.js";

const origin = "http://localhost:4199";
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

async function setup() {
  const store = new Store(":memory:");
  const mediaDir = mkdtempSync(join(tmpdir(), "sg-media-"));
  const server = createServer({
    store,
    secret: "owner",
    origin,
    mediaDir,
  }).listen(0);
  const port = (server.address() as { port: number }).port;
  const base = `http://localhost:${port}/api`;
  const json = async (path: string, body?: unknown, cookie?: string) =>
    fetch(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const login = await json("/login", { secret: "owner" });
  const ownerCookie = login.headers.get("set-cookie")!.split(";")[0];
  const journey = (await (
    await json("/journeys", { title: "Shared" }, ownerCookie)
  ).json()) as any;
  const member = async (name: string) => {
    const inv = (await (
      await json(`/journeys/${journey.id}/members`, { name }, ownerCookie)
    ).json()) as any;
    const r = (await (
      await json("/members/redeem", { invite: inv.invite })
    ).json()) as any;
    return { id: r.memberId as string, token: r.memberToken as string };
  };
  const upload = (bytes: Buffer, mime: string, token: string) =>
    fetch(`${base}/journeys/${journey.id}/media`, {
      method: "PUT",
      headers: { "Content-Type": mime, Authorization: `Bearer ${token}` },
      body: new Uint8Array(bytes),
    });
  const fetchMedia = (
    id: string,
    cred: { token?: string; cookie?: string },
    headers: Record<string, string> = {},
  ) =>
    fetch(`${base}/journeys/${journey.id}/media/${id}`, {
      headers: {
        ...headers,
        ...(cred.token ? { Authorization: `Bearer ${cred.token}` } : {}),
        ...(cred.cookie ? { Cookie: cred.cookie } : {}),
      },
    });
  return {
    store,
    mediaDir,
    port,
    journey,
    ownerCookie,
    member,
    upload,
    fetchMedia,
    close() {
      server.close();
      store.close();
      rmSync(mediaDir, { recursive: true, force: true });
    },
  };
}

const filesIn = (dir: string): string[] =>
  existsSync(dir)
    ? readdirSync(dir, { recursive: true, withFileTypes: true })
        .filter((e) => e.isFile())
        .map((e) => join(e.parentPath, e.name))
    : [];

test("a 2 MB webm upload is stored on disk with its sha256 recorded", async () => {
  const t = await setup();
  try {
    const a = await t.member("Amadeo");
    const bytes = randomBytes(2 * 1024 * 1024);
    const r = await t.upload(bytes, "video/webm;codecs=vp9,opus", a.token);
    assert.equal(r.status, 201);
    const body = (await r.json()) as any;
    assert.equal(body.sha256, sha(bytes));
    assert.equal(body.size, bytes.length);
    assert.equal(body.mime, "video/webm");
    const row = getMedia(t.store, body.id)!;
    assert.equal(row.sha256, sha(bytes));
    assert.equal(row.uploader, a.id);
    assert.equal(row.journey, t.journey.id);
    const files = filesIn(join(t.mediaDir, "files"));
    assert.equal(files.length, 1);
    assert.deepEqual(filesIn(join(t.mediaDir, "tmp")), []);
  } finally {
    t.close();
  }
});

test("a Range request for bytes 0-99 returns 206 with 100 bytes", async () => {
  const t = await setup();
  try {
    const a = await t.member("Amadeo");
    const bytes = randomBytes(4096);
    const { id } = (await (
      await t.upload(bytes, "audio/webm", a.token)
    ).json()) as any;
    const r = await t.fetchMedia(id, a, { Range: "bytes=0-99" });
    assert.equal(r.status, 206);
    assert.equal(r.headers.get("content-range"), `bytes 0-99/${bytes.length}`);
    assert.equal(r.headers.get("content-type"), "audio/webm");
    const got = Buffer.from(await r.arrayBuffer());
    assert.equal(got.length, 100);
    assert.deepEqual(got, bytes.subarray(0, 100));
    const full = await t.fetchMedia(id, a);
    assert.equal(full.status, 200);
    assert.equal(full.headers.get("accept-ranges"), "bytes");
  } finally {
    t.close();
  }
});

test("text/plain or a 501 MB body is refused plainly; audio/webm is accepted", async () => {
  const t = await setup();
  try {
    const a = await t.member("Amadeo");
    const plain = await t.upload(Buffer.from("hello"), "text/plain", a.token);
    assert.equal(plain.status, 415);
    assert.match(((await plain.json()) as any).error.message, /audio|video/i);

    const big = await new Promise<{ status: number; body: string }>(
      (resolve, reject) => {
        const req = request(
          {
            port: t.port,
            method: "PUT",
            path: `/api/journeys/${t.journey.id}/media`,
            headers: {
              "Content-Type": "video/webm",
              "Content-Length": String(501 * 1024 * 1024),
              Authorization: `Bearer ${a.token}`,
            },
          },
          (res) => {
            let body = "";
            res.on("data", (c) => (body += c));
            res.on("end", () => resolve({ status: res.statusCode!, body }));
          },
        );
        req.on("error", reject);
        req.flushHeaders();
      },
    );
    assert.equal(big.status, 413);
    assert.match(JSON.parse(big.body).error.message, /500 MB/);

    const ok = await t.upload(randomBytes(1000), "audio/webm", a.token);
    assert.equal(ok.status, 201);
    assert.deepEqual(filesIn(join(t.mediaDir, "tmp")), []);
  } finally {
    t.close();
  }
});

test("uploading the same bytes twice returns the same id and stores one file", async () => {
  const t = await setup();
  try {
    const a = await t.member("Amadeo");
    const bytes = randomBytes(10000);
    const first = (await (
      await t.upload(bytes, "video/mp4", a.token)
    ).json()) as any;
    const again = await t.upload(bytes, "video/mp4", a.token);
    assert.equal(again.status, 200);
    assert.equal(((await again.json()) as any).id, first.id);
    assert.equal(filesIn(join(t.mediaDir, "files")).length, 1);
    assert.deepEqual(filesIn(join(t.mediaDir, "tmp")), []);
  } finally {
    t.close();
  }
});

test("a restricted recording is readable only by its recorder", async () => {
  const t = await setup();
  try {
    const recorder = await t.member("Amadeo");
    const other = await t.member("Alex");
    const { id } = (await (
      await t.upload(randomBytes(500), "audio/mp4", recorder.token)
    ).json()) as any;
    setMediaRestricted(t.store, id, recorder.id);
    assert.equal((await t.fetchMedia(id, other)).status, 403);
    assert.equal(
      (await t.fetchMedia(id, { cookie: t.ownerCookie })).status,
      403,
    );
    assert.equal((await t.fetchMedia(id, recorder)).status, 200);
    setMediaRestricted(t.store, id, null);
    assert.equal((await t.fetchMedia(id, other)).status, 200);
    assert.equal(
      (await t.fetchMedia(id, { cookie: t.ownerCookie })).status,
      200,
    );
  } finally {
    t.close();
  }
});

test("media of one journey is not served through another", async () => {
  const t = await setup();
  try {
    const a = await t.member("Amadeo");
    const { id } = (await (
      await t.upload(randomBytes(500), "audio/webm", a.token)
    ).json()) as any;
    const r = await fetch(
      `http://localhost:${t.port}/api/journeys/elsewhere/media/${id}`,
      { headers: { Cookie: t.ownerCookie } },
    );
    assert.equal(r.status, 404);
  } finally {
    t.close();
  }
});

test("the sweep removes an unreferenced upload older than a day and keeps a referenced one", async () => {
  const t = await setup();
  try {
    const a = await t.member("Amadeo");
    const keep = (await (
      await t.upload(randomBytes(300), "audio/webm", a.token)
    ).json()) as any;
    const drop = (await (
      await t.upload(randomBytes(300), "audio/webm", a.token)
    ).json()) as any;
    referenceMedia(t.store, keep.id);
    assert.deepEqual(sweepMedia(t.store, t.mediaDir), []);
    const removed = sweepMedia(t.store, t.mediaDir, Date.now() + 86400000 + 1);
    assert.deepEqual(removed, [drop.id]);
    assert.equal(getMedia(t.store, drop.id), null);
    assert.ok(getMedia(t.store, keep.id));
    assert.equal(filesIn(join(t.mediaDir, "files")).length, 1);
    assert.equal((await t.fetchMedia(keep.id, a)).status, 200);
    assert.equal((await t.fetchMedia(drop.id, a)).status, 404);
  } finally {
    t.close();
  }
});

test("a body without a length that runs past the cap is refused and leaves no file", async () => {
  const store = new Store(":memory:");
  const dir = mkdtempSync(join(tmpdir(), "sg-media-"));
  try {
    await assert.rejects(
      saveUpload(
        store,
        dir,
        {
          journey: "j",
          uploader: "m",
          contentType: "video/webm",
          contentLength: undefined,
          body: Readable.from([randomBytes(600), randomBytes(600)]),
        },
        1000,
      ),
      (e: any) => e.status === 413 && /500 MB/.test(e.message),
    );
    assert.deepEqual(filesIn(dir), []);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
