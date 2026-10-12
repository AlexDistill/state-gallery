import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import sharp from "sharp";
import { Client } from "../src/cli/client.js";

test("proxy HTML errors retain their HTTP status instead of becoming JSON syntax errors", async () => {
  const server = createServer((_, res) => {
    res.writeHead(502, { "Content-Type": "text/html" });
    res.end("<html>Proxy unavailable</html>");
  }).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  try {
    const client = new Client(
      `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    );
    await assert.rejects(() => client.request("/journeys"), /502.*Bad Gateway/);
  } finally {
    server.close();
  }
});

test("parallel client reads share one owner login", async () => {
  let logins = 0;
  const server = createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/api/login") {
      logins++;
      setTimeout(() => {
        res.setHeader("Set-Cookie", "sg_session=fixture-session; HttpOnly");
        res.end(JSON.stringify({ role: "owner" }));
      }, 20);
    } else if (req.headers.cookie === "sg_session=fixture-session") {
      res.end("[]");
    } else {
      res.writeHead(401);
      res.end(JSON.stringify({ error: { message: "Not signed in" } }));
    }
  }).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  try {
    const client = new Client(
      `http://127.0.0.1:${(server.address() as { port: number }).port}`,
      undefined,
      "fixture-owner",
    );
    const results = await Promise.all(
      Array.from({ length: 20 }, () => client.listJourneys()),
    );
    assert.equal(results.length, 20);
    assert.equal(logins, 1);
  } finally {
    server.close();
  }
});

test("revision exports keep JPEG identity and refuse to overwrite local revision work", async () => {
  const image = await sharp({
    create: { width: 20, height: 30, channels: 3, background: "#eee" },
  })
    .jpeg()
    .toBuffer();
  const version = {
    schemaVersion: 1,
    id: "version-one",
    steps: [
      {
        id: "first",
        title: "First",
        kind: "mockup",
        viewport: { width: 20, height: 30 },
        assetId: "asset-one",
      },
    ],
  };
  const server = createServer((req, res) => {
    if (req.url?.endsWith("/asset-one")) {
      res.writeHead(200, { "Content-Type": "image/jpeg" });
      res.end(image);
    } else {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          id: "request-one",
          versionId: version.id,
          brief: "Review the design.",
          comments: [],
          evidenceVersions: [version],
          stale: false,
        }),
      );
    }
  }).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const root = await mkdtemp(join(tmpdir(), "sg-export-"));
  try {
    const directory = join(root, "review-pass");
    const client = new Client(
      `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    );
    await client.exportRequest("journey-one", "request-one", directory);
    const manifest = JSON.parse(
      await readFile(join(directory, "manifest.json"), "utf8"),
    );
    assert.match(manifest.steps[0].image, /\.jpeg$/);
    assert.deepEqual(
      await readFile(join(directory, manifest.steps[0].image)),
      image,
    );
    await assert.rejects(
      () => client.exportRequest("journey-one", "request-one", directory),
      /already exists/,
    );
    assert.deepEqual(
      await readFile(join(directory, manifest.steps[0].image)),
      image,
    );
  } finally {
    server.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("missing CLI arguments show the command's usage without attempting a request", async () => {
  const exec = promisify(execFile);
  const result = await exec(process.execPath, [
    "--import",
    "tsx",
    "src/cli/index.ts",
    "submit",
  ]).catch((error) => error);
  assert.equal(result.code, 1);
  assert.match(
    result.stderr,
    /Usage: state-gallery submit <journey> <manifest> <submission-key>/,
  );
  assert.doesNotMatch(result.stderr, /paths\[0\]|Received undefined/);
});
