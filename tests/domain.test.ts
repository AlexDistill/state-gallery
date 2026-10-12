import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/server/domain.js";
test("submission keys with special object names still replay after persistence", () => {
  const store = new Store(":memory:");
  try {
    const journey = store.createJourney("Special key");
    const manifest = {
      schemaVersion: 1,
      steps: [
        {
          id: "gap",
          title: "Gap",
          kind: "gap",
          outcome: "missing",
          viewport: { width: 100, height: 100 },
        },
      ],
    };
    const first = store.submit(journey.id, manifest, {}, "__proto__");
    assert.equal(
      store.submit(journey.id, manifest, {}, "__proto__").id,
      first.id,
    );
    assert.equal(store.get(journey.id).versions.length, 1);
  } finally {
    store.close();
  }
});
test("immutable mixed versions and stale approvals", () => {
  const s = new Store(":memory:");
  const j = s.createJourney("Checkout");
  const m = {
    schemaVersion: 1,
    steps: [
      {
        id: "welcome",
        title: "Welcome",
        purpose: "Start",
        transition: "Continue",
        kind: "gap",
        viewport: { width: 390, height: 844 },
        outcome: "missing",
      },
    ],
  };
  const v = s.submit(j.id, m, {}, "one");
  assert.equal(s.submit(j.id, m, {}, "one").id, v.id);
  assert.throws(() => s.submit(j.id, { ...m, steps: [] }, {}, "bad"));
  const c = s.comment(j.id, v.id, "welcome", "Maya", "Clarify", {
    kind: "screen",
  });
  assert.throws(() => s.approve(j.id, v.id, 0));
  s.resolve(j.id, c.id, true, s.get(j.id).generation);
  const state = s.get(j.id);
  s.approve(j.id, v.id, state.generation);
  assert.ok(s.get(j.id).authorization);
  s.comment(j.id, v.id, "welcome", "Sam", "Another", { kind: "screen" });
  assert.equal(s.get(j.id).authorization, null);
  s.close();
});
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
test("versions retain images, old feedback, late feedback, request snapshots and idempotency across restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sg-domain-"));
  const path = join(dir, "db.sqlite");
  let s = new Store(path);
  try {
    const j = s.createJourney("Checkout");
    const bytes = await sharp({
      create: { width: 100, height: 100, channels: 3, background: "#eee" },
    })
      .png()
      .toBuffer();
    const assets = {
      "one.png": { bytes, mime: "image/png", width: 100, height: 100 },
    };
    const m = {
      schemaVersion: 1,
      steps: [
        {
          id: "a",
          title: "Original title",
          kind: "mockup",
          viewport: { width: 100, height: 100 },
          image: "one.png",
        },
      ],
    };
    const v = s.submit(j.id, m, assets, "one");
    const c = s.comment(j.id, v.id, "a", "Maya", "Move button", {
      kind: "region",
      x: 0.1,
      y: 0.2,
      width: 0.2,
      height: 0.3,
    });
    const q = s.request(j.id, v.id, s.get(j.id).generation);
    const late = s.comment(j.id, v.id, "a", "Julio", "Late feedback", {
      kind: "point",
      x: 0.5,
      y: 0.5,
    });
    const successor = {
      ...m,
      parentId: v.id,
      requestId: q.id,
      responses: { [c.id]: "Moved" },
      steps: [{ ...m.steps[0], id: "b", title: "Replacement" }],
    };
    const v2 = s.submit(j.id, successor, assets, "two");
    assert.equal(s.submit(j.id, successor, assets, "two").id, v2.id);
    assert.throws(
      () => s.submit(j.id, { ...successor, title: "changed" }, assets, "two"),
      /different content/,
    );
    assert.throws(
      () => s.submit(j.id, successor, assets, "three"),
      /Parent is stale/,
    );
    assert.equal(
      s.get(j.id).comments.find((x: any) => x.id === c.id)!.resolved,
      false,
    );
    assert.equal(s.get(j.id).requests[0].comments.length, 1);
    assert.equal(s.get(j.id).comments.length, 2);
    assert.deepEqual(
      Buffer.from(s.asset(v.steps[0].assetId!, j.id).bytes as Uint8Array),
      bytes,
    );
    assert.throws(
      () => s.approve(j.id, v2.id, s.get(j.id).generation),
      /Resolve all/,
    );
    s.resolve(j.id, c.id, true, s.get(j.id).generation);
    s.resolve(j.id, late.id, true, s.get(j.id).generation);
    const stale = s.get(j.id).generation;
    s.reply(j.id, c.id, "Maya", "One more detail");
    assert.throws(() => s.approve(j.id, v2.id, stale), /Review changed/);
    s.resolve(j.id, c.id, true, s.get(j.id).generation);
    s.approve(j.id, v2.id, s.get(j.id).generation);
    s.close();
    s = new Store(path);
    assert.equal(s.get(j.id).authorization!.versionId, v2.id);
    assert.equal(s.get(j.id).versions.length, 2);
    const q2 = s.request(j.id, v2.id, s.get(j.id).generation);
    assert.equal(s.get(j.id).authorization, null);
    assert.equal(s.get(j.id).approvals.length, 1);
    assert.ok(q2.id);
  } finally {
    s.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("invalid image anchors and atomic invalid imports", () => {
  const s = new Store(":memory:");
  try {
    const j = s.createJourney("Gaps");
    const m = {
      schemaVersion: 1,
      steps: [
        {
          id: "gap",
          title: "Gap",
          kind: "gap",
          viewport: { width: 100, height: 100 },
          outcome: "missing",
        },
      ],
    };
    const v = s.submit(j.id, m, {}, "one");
    assert.throws(
      () =>
        s.comment(j.id, v.id, "gap", "Maya", "Pin", {
          kind: "point",
          x: 0.3,
          y: 0.2,
        }),
      /require an image/,
    );
    assert.throws(
      () => s.comment(j.id, v.id, "wrong", "Maya", "Note", { kind: "screen" }),
      /does not belong/,
    );
    assert.throws(() =>
      s.comment(j.id, v.id, "gap", "Maya", "Rect", {
        kind: "region",
        x: 0.9,
        y: 0.9,
        width: 0.2,
        height: 0.1,
      }),
    );
    assert.throws(
      () =>
        s.submit(
          j.id,
          {
            ...m,
            parentId: v.id,
            steps: [
              {
                ...m.steps[0],
                kind: "capture",
                image: "absent",
                outcome: "captured",
              },
            ],
          },
          {},
          "two",
        ),
      /Missing asset/,
    );
    assert.equal(s.get(j.id).versions.length, 1);
    assert.throws(() =>
      s.submit(j.id, { ...m, coverage: "complete" }, {}, "bad"),
    );
    assert.throws(() =>
      s.submit(
        j.id,
        { ...m, coverage: "complete", expected: ["gap"] },
        {},
        "bad",
      ),
    );
  } finally {
    s.close();
  }
});

test("unseen replies cannot be resolved with a stale owner decision", () => {
  const s = new Store(":memory:");
  try {
    const j = s.createJourney("Review");
    const v = s.submit(
      j.id,
      {
        schemaVersion: 1,
        steps: [
          {
            id: "a",
            title: "A",
            kind: "gap",
            outcome: "missing",
            viewport: { width: 100, height: 100 },
          },
        ],
      },
      {},
      "one",
    );
    const c = s.comment(j.id, v.id, "a", "Maya", "Note", { kind: "screen" });
    const generation = s.get(j.id).generation;
    s.reply(j.id, c.id, "Julio", "Unseen reply");
    assert.throws(
      () => s.resolve(j.id, c.id, true, generation),
      /Refresh before resolving/,
    );
    assert.equal(s.get(j.id).comments[0].resolved, false);
  } finally {
    s.close();
  }
});
test("a superseded revision request conflicts without replacing the current version", () => {
  const s = new Store(":memory:");
  try {
    const j = s.createJourney("Revision");
    const m = {
      schemaVersion: 1,
      steps: [
        {
          id: "a",
          title: "A",
          kind: "gap",
          outcome: "missing",
          viewport: { width: 100, height: 100 },
        },
      ],
    };
    const v = s.submit(j.id, m, {}, "initial");
    const old = s.request(j.id, v.id, s.get(j.id).generation);
    const current = s.request(j.id, v.id, s.get(j.id).generation);
    assert.throws(
      () =>
        s.submit(
          j.id,
          { ...m, parentId: v.id, requestId: old.id },
          {},
          "stale",
        ),
      /request is stale/,
    );
    assert.equal(s.get(j.id).currentId, v.id);
    assert.ok(
      s.submit(
        j.id,
        { ...m, parentId: v.id, requestId: current.id },
        {},
        "fresh",
      ).id,
    );
  } finally {
    s.close();
  }
});
