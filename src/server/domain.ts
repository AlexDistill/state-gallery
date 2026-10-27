import type {
  Journey,
  Version,
  Comment,
  RevisionRequest,
  MemberGrant,
} from "../shared/model.js";
import { DatabaseSync } from "node:sqlite";
import { randomUUID, createHash, randomBytes } from "node:crypto";
import { anchorSchema, manifestSchema } from "../shared/schema.js";
export class Fault extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const INVITE_LIFETIME = 7 * 86400000;
const grantRow = (r: Record<string, unknown>): MemberGrant => ({
  id: String(r.id),
  journey: String(r.journey),
  name: String(r.name),
  createdAt: Number(r.created_at),
  inviteExpiresAt: Number(r.invite_expires_at),
  redeemedAt: r.redeemed_at == null ? null : Number(r.redeemed_at),
  revokedAt: r.revoked_at == null ? null : Number(r.revoked_at),
  linkedLoopAt: r.linked_loop_at == null ? null : Number(r.linked_loop_at),
});
export const digest = (v: unknown) =>
  createHash("sha256")
    .update(typeof v === "string" || Buffer.isBuffer(v) ? v : JSON.stringify(v))
    .digest("hex");
export class Store {
  db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(
      `PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS journeys(id TEXT PRIMARY KEY, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY,journey TEXT NOT NULL,mime TEXT NOT NULL,bytes BLOB NOT NULL,width INTEGER,height INTEGER); CREATE TABLE IF NOT EXISTS auth(id TEXT PRIMARY KEY,body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS member_grants(id TEXT PRIMARY KEY,journey TEXT NOT NULL,name TEXT NOT NULL,invite_hash TEXT UNIQUE,token_hash TEXT UNIQUE,created_at INTEGER NOT NULL,invite_expires_at INTEGER NOT NULL,redeemed_at INTEGER,revoked_at INTEGER,linked_loop_at INTEGER);`,
    );
  }
  close() {
    this.db.close();
  }
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const v = fn();
      this.db.exec("COMMIT");
      return v;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  list(): Journey[] {
    return this.db
      .prepare("SELECT body FROM journeys")
      .all()
      .map((r) => JSON.parse(String(r.body)));
  }
  get(id: string): Journey {
    const r = this.db.prepare("SELECT body FROM journeys WHERE id=?").get(id);
    if (!r) throw new Fault(404, "Journey not found");
    return JSON.parse(String(r.body));
  }
  save(j: Journey) {
    this.db
      .prepare("INSERT OR REPLACE INTO journeys VALUES(?,?)")
      .run(j.id, JSON.stringify(j));
  }
  createJourney(title: string) {
    if (!title.trim() || title.length > 200)
      throw new Fault(400, "Choose a title of 1–200 characters");
    const j: Journey = {
      id: randomUUID(),
      title,
      generation: 0,
      currentId: null,
      versions: [],
      comments: [],
      requests: [],
      approvals: [],
      authorization: null,
      submissions: {},
    };
    this.save(j);
    return j;
  }
  mutate<T>(id: string, fn: (j: Journey) => T): T {
    return this.transaction(() => {
      const j = this.get(id);
      const v = fn(j);
      this.save(j);
      return v;
    });
  }
  changed(j: Journey) {
    j.generation++;
    j.authorization = null;
  }
  check(j: Journey, version: string, generation: number) {
    if (j.currentId !== version || j.generation !== generation)
      throw new Fault(
        409,
        "Review changed. Refresh the journey and try again.",
      );
  }
  submit(
    id: string,
    raw: unknown,
    assets: Record<
      string,
      { bytes: Buffer; mime: string; width: number; height: number } | Buffer
    >,
    key: string,
  ) {
    const m = manifestSchema.parse(raw);
    if (!key || key.length > 200)
      throw new Fault(400, "A submission key is required");
    const hash = digest({
      manifest: m,
      assets: Object.entries(assets)
        .sort()
        .map(([k, v]) => [k, digest(Buffer.isBuffer(v) ? v : v.bytes)]),
    });
    return this.mutate(id, (j) => {
      if (Object.hasOwn(j.submissions, key)) {
        if (j.submissions[key].hash !== hash)
          throw new Fault(
            409,
            "Submission key already used with different content",
          );
        return j.versions.find((v) => v.id === j.submissions[key].id)!;
      }
      if (m.parentId !== (j.currentId ?? undefined))
        throw new Fault(409, "Parent is stale. Fetch current context.");
      if (m.requestId) {
        const q = j.requests.find((q) => q.id === m.requestId);
        if (
          !q ||
          q.id !== j.requests.at(-1)?.id ||
          q.versionId !== j.currentId ||
          q.successorId
        )
          throw new Fault(
            409,
            "Revision request is stale. Export the current request.",
          );
        if (
          Object.keys(m.responses).some(
            (k) => !q.comments.some((c) => c.id === k),
          )
        )
          throw new Fault(400, "Response references feedback outside request");
      } else if (Object.keys(m.responses).length)
        throw new Fault(400, "Responses require a revision request");
      const steps = m.steps.map((s) => {
        if (!s.image) return s;
        if (!Object.hasOwn(assets, s.image))
          throw new Fault(400, `Missing asset: ${s.image}`);
        const a = assets[s.image];
        const bytes = Buffer.isBuffer(a) ? a : a.bytes;
        const assetId = digest(id + digest(bytes));
        if (Buffer.isBuffer(a))
          throw new Fault(400, "Assets must include decoded image metadata");
        this.db
          .prepare("INSERT OR IGNORE INTO assets VALUES(?,?,?,?,?,?)")
          .run(assetId, id, a.mime, bytes, a.width, a.height);
        return { ...s, assetId, width: a.width, height: a.height };
      });
      const v: Version = {
        ...m,
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        steps,
      };
      j.versions.push(v);
      j.currentId = v.id;
      j.submissions = { ...j.submissions, [key]: { hash, id: v.id } };
      if (m.requestId)
        j.requests.find((q) => q.id === m.requestId)!.successorId = v.id;
      this.changed(j);
      return v;
    });
  }
  comment(
    id: string,
    versionId: string,
    stepId: string,
    author: string,
    text: string,
    rawAnchor: unknown,
  ) {
    const anchor = anchorSchema.parse(rawAnchor);
    if (
      !author.trim() ||
      author.length > 100 ||
      !text.trim() ||
      text.length > 4000
    )
      throw new Fault(
        400,
        "Name and comment are required (100 / 4000 characters maximum)",
      );
    return this.mutate(id, (j) => {
      const v = j.versions.find((v) => v.id === versionId);
      const s = v?.steps.find((s) => s.id === stepId);
      if (!s) throw new Fault(400, "Screen does not belong to this version");
      if (anchor.kind !== "screen" && !s.assetId)
        throw new Fault(400, "Point and region comments require an image");
      const c: Comment = {
        id: randomUUID(),
        versionId,
        stepId,
        assetId: s.assetId ?? null,
        anchor,
        author,
        text,
        replies: [],
        resolved: false,
        createdAt: new Date().toISOString(),
      };
      j.comments.push(c);
      this.changed(j);
      return c;
    });
  }
  reply(id: string, cid: string, author: string, text: string) {
    if (
      !author.trim() ||
      author.length > 100 ||
      !text.trim() ||
      text.length > 4000
    )
      throw new Fault(400, "A name and reply are required");
    return this.mutate(id, (j) => {
      const c = j.comments.find((c) => c.id === cid);
      if (!c) throw new Fault(404, "Comment not found");
      c.replies.push({
        id: randomUUID(),
        author,
        text,
        createdAt: new Date().toISOString(),
      });
      c.resolved = false;
      this.changed(j);
      return c;
    });
  }
  resolve(id: string, cid: string, resolved: boolean, generation: number) {
    return this.mutate(id, (j) => {
      if (j.generation !== generation)
        throw new Fault(
          409,
          "Review changed. Refresh before resolving feedback.",
        );
      const c = j.comments.find((c) => c.id === cid);
      if (!c) throw new Fault(404, "Comment not found");
      c.resolved = resolved;
      this.changed(j);
      return c;
    });
  }
  request(id: string, versionId: string, generation: number) {
    return this.mutate(id, (j) => {
      this.check(j, versionId, generation);
      const q: RevisionRequest = {
        id: randomUUID(),
        versionId,
        comments: structuredClone(j.comments.filter((c) => !c.resolved)),
        createdAt: new Date().toISOString(),
        successorId: null,
      };
      j.requests.push(q);
      this.changed(j);
      return q;
    });
  }
  approve(id: string, versionId: string, generation: number) {
    return this.mutate(id, (j) => {
      this.check(j, versionId, generation);
      if (!versionId || j.comments.some((c) => !c.resolved))
        throw new Fault(
          409,
          "Resolve all open feedback, including earlier versions, before approval",
        );
      const a = {
        id: randomUUID(),
        versionId,
        generation,
        createdAt: new Date().toISOString(),
      };
      j.approvals.push(a);
      j.authorization = a;
      return a;
    });
  }
  asset(id: string, journey: string) {
    const a = this.db
      .prepare("SELECT * FROM assets WHERE id=? AND journey=?")
      .get(id, journey);
    if (!a) throw new Fault(404, "Image not found");
    return a;
  }
  authSave(id: string, body: any) {
    this.db
      .prepare("INSERT OR REPLACE INTO auth VALUES(?,?)")
      .run(id, JSON.stringify(body));
  }
  authGet(id: string): any {
    const r = this.db.prepare("SELECT body FROM auth WHERE id=?").get(id);
    return r ? JSON.parse(String(r.body)) : null;
  }
  inviteMember(journey: string, rawName: string, now = Date.now()) {
    this.get(journey);
    const name = rawName.trim();
    if (!name || name.length > 100)
      throw new Fault(400, "Enter a display name (up to 100 characters)");
    const invite = randomBytes(32).toString("base64url");
    const id = randomUUID();
    this.db
      .prepare(
        "INSERT INTO member_grants(id,journey,name,invite_hash,created_at,invite_expires_at) VALUES(?,?,?,?,?,?)",
      )
      .run(id, journey, name, digest(invite), now, now + INVITE_LIFETIME);
    return { ...this.memberGrant(id)!, invite };
  }
  redeemInvite(invite: string, now = Date.now()) {
    const token = randomBytes(32).toString("base64url");
    return this.transaction(() => {
      const r = this.db
        .prepare(
          "SELECT id FROM member_grants WHERE invite_hash=? AND redeemed_at IS NULL AND revoked_at IS NULL AND invite_expires_at>?",
        )
        .get(digest(invite), now);
      if (!invite || !r)
        throw new Fault(
          401,
          "This invite expired, was revoked or was already used. Ask the owner for a new invite.",
        );
      this.db
        .prepare(
          "UPDATE member_grants SET invite_hash=NULL, token_hash=?, redeemed_at=? WHERE id=?",
        )
        .run(digest(token), now, String(r.id));
      return { grant: this.memberGrant(String(r.id))!, token };
    });
  }
  memberGrant(id: string): MemberGrant | null {
    const r = this.db.prepare("SELECT * FROM member_grants WHERE id=?").get(id);
    return r ? grantRow(r) : null;
  }
  memberGrantByToken(token: string): MemberGrant | null {
    if (!token) return null;
    const r = this.db
      .prepare("SELECT * FROM member_grants WHERE token_hash=?")
      .get(digest(token));
    return r ? grantRow(r) : null;
  }
  revokeMember(journey: string, id: string, now = Date.now()) {
    const g = this.memberGrant(id);
    if (!g || g.journey !== journey) throw new Fault(404, "Member not found");
    this.db
      .prepare(
        "UPDATE member_grants SET revoked_at=COALESCE(revoked_at,?) WHERE id=?",
      )
      .run(now, id);
    return this.memberGrant(id)!;
  }
  markLinkedLoop(id: string, now = Date.now()) {
    this.db
      .prepare(
        "UPDATE member_grants SET linked_loop_at=COALESCE(linked_loop_at,?) WHERE id=?",
      )
      .run(now, id);
    return this.memberGrant(id);
  }
}
