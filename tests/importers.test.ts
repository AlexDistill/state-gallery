import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { importContentFactory, importSigma } from "../src/importers/index.js";
import { loadManifest } from "../src/cli/client.js";
test("a declared image named __proto__ survives the local upload dictionary", async () => {
  const root = await mkdtemp(join(tmpdir(), "sg-image-key-"));
  const bytes = await sharp({
    create: { width: 10, height: 10, channels: 3, background: "#eee" },
  })
    .png()
    .toBuffer();
  await writeFile(join(root, "__proto__"), bytes);
  await writeFile(
    join(root, "manifest.json"),
    JSON.stringify({
      schemaVersion: 1,
      steps: [
        {
          id: "first",
          title: "First",
          kind: "mockup",
          viewport: { width: 10, height: 10 },
          image: "__proto__",
        },
      ],
    }),
  );
  const payload = await loadManifest(join(root, "manifest.json"));
  assert.ok(Object.hasOwn(payload.assets, "__proto__"));
  assert.equal(payload.assets["__proto__"], bytes.toString("base64"));
});
test("observed formats preserve identity, unknown coverage and missing inventory", async () => {
  const root = await mkdtemp(join(tmpdir(), "sg-import-"));
  const image = await sharp({
    create: { width: 390, height: 844, channels: 3, background: "#eee" },
  })
    .png()
    .toBuffer();
  await writeFile(join(root, "a.png"), image);
  await writeFile(
    join(root, "run.json"),
    JSON.stringify({
      entries: [
        {
          path: "checkout/welcome@390.png",
          file: "a.png",
          outcome: "captured",
          comparison: "changed",
        },
      ],
    }),
  );
  const cf = await importContentFactory(root);
  assert.equal(cf.coverage, "unknown");
  assert.match(cf.steps[0].provenance, /checkout\/welcome/);
  await mkdir(join(root, "one"));
  await writeFile(join(root, "one", "a.png"), image);
  await writeFile(
    join(root, "inventory.json"),
    JSON.stringify({ schemaVersion: 1, keys: ["s/p/G1", "s/p/G2"] }),
  );
  await writeFile(
    join(root, "one", "capture.json"),
    JSON.stringify({
      key: "s/p/G1",
      scenario: "s",
      phase: "p",
      tableId: "G1",
      viewport: { width: 390, height: 844 },
      images: [{ kind: "viewport", file: "a.png" }],
    }),
  );
  const sigma = await importSigma(root);
  assert.equal(sigma.coverage, "partial");
  assert.equal(sigma.steps[1].outcome, "missing");
  assert.ok(sigma.steps[0].tags.includes("G1"));
});
test("manifest readers reject traversal and symlink escape", async () => {
  const root = await mkdtemp(join(tmpdir(), "sg-safe-"));
  const outside = await mkdtemp(join(tmpdir(), "sg-out-"));
  await writeFile(join(outside, "secret.png"), "secret");
  await symlink(join(outside, "secret.png"), join(root, "escape.png"));
  const manifest = {
    schemaVersion: 1,
    steps: [
      {
        id: "a",
        title: "A",
        kind: "capture",
        viewport: { width: 10, height: 10 },
        image: "escape.png",
      },
    ],
  };
  await writeFile(join(root, "manifest.json"), JSON.stringify(manifest));
  await assert.rejects(
    () => loadManifest(join(root, "manifest.json")),
    /escapes/,
  );
  manifest.steps[0].image = "../secret.png";
  await writeFile(join(root, "manifest.json"), JSON.stringify(manifest));
  await assert.rejects(
    () => loadManifest(join(root, "manifest.json")),
    /relative/,
  );
});
test("local validation rejects non-raster declared files before upload", async () => {
  const root = await mkdtemp(join(tmpdir(), "sg-raster-"));
  await writeFile(join(root, "private.json"), "{}");
  await writeFile(
    join(root, "manifest.json"),
    JSON.stringify({
      schemaVersion: 1,
      steps: [
        {
          id: "a",
          title: "A",
          kind: "capture",
          viewport: { width: 10, height: 10 },
          image: "private.json",
        },
      ],
    }),
  );
  await assert.rejects(
    () => loadManifest(join(root, "manifest.json")),
    /valid single PNG/,
  );
});
test("large Sigma expected inventories remain honest and selectable", async () => {
  const root = await mkdtemp(join(tmpdir(), "sg-large-"));
  const keys = Array.from(
    { length: 833 },
    (_, i) => `${i < 400 ? "first" : "second"}/phase/G${i}`,
  );
  await writeFile(
    join(root, "inventory.json"),
    JSON.stringify({ schemaVersion: 1, keys }),
  );
  const full = await importSigma(root);
  assert.equal(full.steps.length, 833);
  assert.equal(full.expected?.length, 833);
  assert.equal(full.coverage, "partial");
  const subset = await importSigma(root, "first/");
  assert.equal(subset.steps.length, 400);
  assert.equal(subset.expected?.length, 400);
  assert.equal(subset.coverage, "partial");
});
test("adapters reject duplicate and missing declared captures", async () => {
  const root = await mkdtemp(join(tmpdir(), "sg-invalid-import-"));
  const entry = { path: "a@390.png", file: "absent.png", outcome: "captured" };
  await writeFile(join(root, "run.json"), JSON.stringify({ entries: [entry] }));
  await assert.rejects(() => importContentFactory(root), /ENOENT/);
  await writeFile(
    join(root, "inventory.json"),
    JSON.stringify({ schemaVersion: 1, keys: ["one", "one"] }),
  );
  await assert.rejects(() => importSigma(root), /duplicate/);
});
