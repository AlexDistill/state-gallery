import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "../src/server/http.js";
import { Store, digest } from "../src/server/domain.js";
test("role boundaries, origin and protected assets", async () => {
  const store = new Store(":memory:");
  const app = createServer({
    store,
    secret: "test-secret",
    origin: "http://localhost:4199",
  });
  const server = app.listen(0);
  try {
    const address = server.address() as { port: number };
    const base = `http://localhost:${address.port}`;
    const call = (
      path: string,
      body?: unknown,
      cookie?: string,
      token?: string,
      origin = "http://localhost:4199",
    ) =>
      fetch(base + path, {
        method: body ? "POST" : "GET",
        headers: {
          "Content-Type": "application/json",
          Origin: origin,
          ...(cookie ? { Cookie: cookie } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    assert.equal((await call("/api/journeys")).status, 401);
    const login = await call("/api/login", { secret: "test-secret" });
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const j = (await (
      await call("/api/journeys", { title: "Checkout" }, cookie)
    ).json()) as any;
    const grant = (await (
      await call(
        `/api/journeys/${j.id}/grants`,
        { role: "reviewer", expiresAt: Date.now() + 60000 },
        cookie,
      )
    ).json()) as any;
    const join = await call("/api/join", { token: grant.token, name: "Maya" });
    const reviewer = join.headers.get("set-cookie")!.split(";")[0];
    assert.equal(
      (await call(`/api/journeys/${j.id}`, undefined, reviewer)).status,
      200,
    );
    assert.equal(
      (
        await call(
          `/api/journeys/${j.id}/approve`,
          { versionId: "x", generation: 0 },
          reviewer,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await call(
          `/api/journeys/${j.id}/grants`,
          { role: "agent" },
          cookie,
          undefined,
          "https://evil.test",
        )
      ).status,
      403,
    );
    await call(`/api/journeys/${j.id}/grants/${grant.id}/revoke`, {}, cookie);
    assert.equal(
      (await call(`/api/journeys/${j.id}`, undefined, reviewer)).status,
      401,
    );
  } finally {
    server.close();
    store.close();
  }
});
import sharp from "sharp";
test("image hashes include special filenames so changed retries conflict", async () => {
  const store = new Store(":memory:");
  const origin = "http://localhost:4199";
  const server = createServer({
    store,
    secret: "fixture-owner",
    origin,
  }).listen(0);
  try {
    const base = `http://localhost:${(server.address() as { port: number }).port}`;
    const login = await fetch(base + "/api/login", {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ secret: "fixture-owner" }),
    });
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const journey = store.createJourney("Special filename");
    const manifest = {
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
    };
    for (const [color, status] of [
      ["#eee", 201],
      ["#ddd", 409],
    ] as const) {
      const bytes = await sharp({
        create: { width: 10, height: 10, channels: 3, background: color },
      })
        .png()
        .toBuffer();
      const result = await fetch(
        `${base}/api/journeys/${journey.id}/versions`,
        {
          method: "POST",
          headers: {
            Origin: origin,
            Cookie: cookie,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            manifest,
            assets: { ["__proto__"]: bytes.toString("base64") },
            submissionKey: "same-key",
          }),
        },
      );
      assert.equal(result.status, status);
    }
    assert.equal(store.get(journey.id).versions.length, 1);
  } finally {
    server.close();
    store.close();
  }
});
test("expired and revoked sessions can sign out without bypassing origin checks", async () => {
  const store = new Store(":memory:");
  const origin = "http://localhost:4199";
  const server = createServer({ store, secret: "test", origin }).listen(0);
  try {
    const base = `http://localhost:${(server.address() as { port: number }).port}`;
    store.authSave("revoked-grant", {
      revoked: true,
      expiresAt: Date.now() + 60000,
    });
    for (const [token, session] of [
      ["expired-session", { role: "owner", expiresAt: Date.now() - 1 }],
      [
        "revoked-session",
        {
          role: "reviewer",
          grantId: "revoked-grant",
          expiresAt: Date.now() + 60000,
        },
      ],
    ] as const) {
      store.authSave(digest(token), session);
      const headers = {
        Cookie: `sg_session=${token}`,
        "Content-Type": "application/json",
      };
      assert.equal(
        (await fetch(base + "/api/session", { headers })).status,
        401,
      );
      const crossOrigin = await fetch(base + "/api/logout", {
        method: "POST",
        headers: { ...headers, Origin: "https://other.test" },
        body: "{}",
      });
      assert.equal(crossOrigin.status, 403);
      assert.ok(store.authGet(digest(token)));
      const logout = await fetch(base + "/api/logout", {
        method: "POST",
        headers: { ...headers, Origin: origin },
        body: "{}",
      });
      assert.equal(logout.status, 200);
      assert.match(logout.headers.get("set-cookie") ?? "", /sg_session=;/);
      assert.equal(store.authGet(digest(token)), null);
    }
  } finally {
    server.close();
    store.close();
  }
});
test("revocation and expiry protect image bytes; scoped agents cannot decide; malformed uploads stay atomic", async () => {
  const store = new Store(":memory:");
  const server = createServer({
    store,
    secret: "test",
    origin: "http://localhost:4199",
  }).listen(0);
  try {
    const base = `http://localhost:${(server.address() as any).port}`;
    const req = async (
      path: string,
      body?: unknown,
      credential?: { cookie?: string; token?: string },
    ) =>
      fetch(base + "/api" + path, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Origin: "http://localhost:4199",
          "Content-Type": "application/json",
          ...(credential?.cookie ? { Cookie: credential.cookie } : {}),
          ...(credential?.token
            ? { Authorization: `Bearer ${credential.token}` }
            : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    const r = await req("/login", { secret: "test" });
    const owner = { cookie: r.headers.get("set-cookie")!.split(";")[0] };
    const j = (await (
      await req("/journeys", { title: "One" }, owner)
    ).json()) as any;
    const other = (await (
      await req("/journeys", { title: "Two" }, owner)
    ).json()) as any;
    const bytes = await sharp({
      create: { width: 80, height: 60, channels: 3, background: "#abc" },
    })
      .png()
      .toBuffer();
    const manifest = {
      schemaVersion: 1,
      steps: [
        {
          id: "a",
          title: "A",
          kind: "mockup",
          viewport: { width: 80, height: 60 },
          image: "a.png",
        },
      ],
    };
    const v = (await (
      await req(
        `/journeys/${j.id}/versions`,
        {
          manifest,
          assets: { "a.png": bytes.toString("base64") },
          submissionKey: "one",
        },
        owner,
      )
    ).json()) as any;
    assert.ok(v.steps[0].assetId);
    const image = `/journeys/${j.id}/assets/${v.steps[0].assetId}`;
    assert.equal((await req(image)).status, 401);
    const g = (await (
      await req(`/journeys/${j.id}/grants`, { role: "reviewer" }, owner)
    ).json()) as any;
    const join = await req("/join", { token: g.token, name: "Maya" });
    const reviewer = { cookie: join.headers.get("set-cookie")!.split(";")[0] };
    assert.equal((await req(image, undefined, reviewer)).status, 200);
    assert.equal(
      (await req(`/journeys/${other.id}`, undefined, reviewer)).status,
      403,
    );
    assert.equal(
      (
        await req(
          `/journeys/${other.id}/assets/${v.steps[0].assetId}`,
          undefined,
          reviewer,
        )
      ).status,
      403,
    );
    await req(`/journeys/${j.id}/grants/${g.id}/revoke`, {}, owner);
    const listed = (await (
      await req(`/journeys/${j.id}/grants`, undefined, owner)
    ).json()) as any[];
    assert.equal(listed.length, 1);
    assert.equal(listed[0].revoked, true);
    assert.equal(
      (await req("/join", { token: g.token, name: "New guest" })).status,
      401,
    );
    assert.equal((await req(image, undefined, reviewer)).status, 401);
    const agent = (await (
      await req(`/journeys/${j.id}/grants`, { role: "agent" }, owner)
    ).json()) as any;
    for (const endpoint of [
      "approve",
      "requests",
      "grants",
      "comments/no/resolve",
    ])
      assert.equal(
        (
          await req(
            `/journeys/${j.id}/${endpoint}`,
            { versionId: v.id, generation: 1, resolved: true },
            { token: agent.token },
          )
        ).status,
        403,
      );
    store.authSave(agent.id, {
      ...store.authGet(agent.id),
      expiresAt: Date.now() - 1,
    });
    assert.equal(
      (await req(image, undefined, { token: agent.token })).status,
      401,
    );
    for (const invalid of [
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      ),
      Buffer.from("not-image"),
      bytes.subarray(0, 40),
    ]) {
      const failed = await req(
        `/journeys/${j.id}/versions`,
        {
          manifest: { ...manifest, parentId: v.id },
          assets: { "a.png": invalid.toString("base64") },
          submissionKey: "bad",
        },
        owner,
      );
      assert.equal(failed.status, 400);
    }
    assert.equal(store.get(j.id).versions.length, 1);
  } finally {
    server.close();
    store.close();
  }
});
