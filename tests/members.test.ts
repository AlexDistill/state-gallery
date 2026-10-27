import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "../src/server/http.js";
import { Store } from "../src/server/domain.js";

const origin = "http://localhost:4199";
const gap = {
  schemaVersion: 1,
  steps: [
    {
      id: "home",
      title: "Home",
      kind: "gap",
      outcome: "missing",
      viewport: { width: 100, height: 100 },
    },
  ],
};

async function setup() {
  const store = new Store(":memory:");
  const server = createServer({ store, secret: "owner", origin }).listen(0);
  const base = `http://localhost:${(server.address() as { port: number }).port}`;
  const call = (
    path: string,
    body?: unknown,
    credential: { cookie?: string; token?: string } = {},
  ) =>
    fetch(base + "/api" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        ...(credential.cookie ? { Cookie: credential.cookie } : {}),
        ...(credential.token
          ? { Authorization: `Bearer ${credential.token}` }
          : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const cookieOf = (r: Response) => r.headers.get("set-cookie")!.split(";")[0];
  const owner = { cookie: cookieOf(await call("/login", { secret: "owner" })) };
  const journey = (await (
    await call("/journeys", { title: "Shared" }, owner)
  ).json()) as any;
  const version = store.submit(journey.id, gap, {}, "first");
  const invite = async (name: string, journeyId = journey.id) => {
    const r = await call(`/journeys/${journeyId}/members`, { name }, owner);
    assert.equal(r.status, 201);
    return (await r.json()) as any;
  };
  const redeem = async (code: string) => {
    const r = await call("/members/redeem", { invite: code });
    return {
      status: r.status,
      cookie: r.ok ? cookieOf(r) : "",
      body: (await r.json()) as any,
    };
  };
  return {
    store,
    server,
    call,
    cookieOf,
    owner,
    journey,
    version,
    invite,
    redeem,
    close() {
      server.close();
      store.close();
    },
  };
}

test("an invite redeems once into a member session and a one-time token", async () => {
  const t = await setup();
  try {
    const inv = await t.invite("Amadeo");
    assert.ok(inv.invite);
    assert.equal(inv.name, "Amadeo");
    const first = await t.redeem(inv.invite);
    assert.equal(first.status, 200);
    assert.equal(first.body.role, "member");
    assert.equal(first.body.name, "Amadeo");
    assert.equal(first.body.memberId, inv.id);
    assert.ok(first.body.memberToken);
    const session = (await (
      await t.call("/session", undefined, { cookie: first.cookie })
    ).json()) as any;
    assert.equal(session.memberId, inv.id);
    assert.equal(session.memberToken, undefined);
    const second = await t.redeem(inv.invite);
    assert.equal(second.status, 401);
  } finally {
    t.close();
  }
});

test("a member's comment author comes from the grant, not typed text", async () => {
  const t = await setup();
  try {
    const m = await t.redeem((await t.invite("Amadeo")).invite);
    for (const credential of [
      { cookie: m.cookie },
      { token: m.body.memberToken },
    ]) {
      const r = await t.call(
        `/journeys/${t.journey.id}/comments`,
        {
          versionId: t.version.id,
          stepId: "home",
          text: "Tighten the header",
          anchor: { kind: "screen" },
          author: "Mallory",
          name: "Mallory",
        },
        credential,
      );
      assert.equal(r.status, 201);
      assert.equal(((await r.json()) as any).author, "Amadeo");
    }
  } finally {
    t.close();
  }
});

test("a member can request a revision; a reviewer still cannot", async () => {
  const t = await setup();
  try {
    const m = await t.redeem((await t.invite("Amadeo")).invite);
    const g = (await (
      await t.call(
        `/journeys/${t.journey.id}/grants`,
        { role: "reviewer" },
        t.owner,
      )
    ).json()) as any;
    const reviewer = {
      cookie: t.cookieOf(
        await t.call("/join", { token: g.token, name: "Maya" }),
      ),
    };
    const body = () => ({
      versionId: t.version.id,
      generation: t.store.get(t.journey.id).generation,
    });
    assert.equal(
      (await t.call(`/journeys/${t.journey.id}/requests`, body(), reviewer))
        .status,
      403,
    );
    assert.equal(
      (
        await t.call(`/journeys/${t.journey.id}/requests`, body(), {
          cookie: m.cookie,
        })
      ).status,
      201,
    );
    assert.equal(
      (
        await t.call(`/journeys/${t.journey.id}/requests`, body(), {
          token: m.body.memberToken,
        })
      ).status,
      201,
    );
  } finally {
    t.close();
  }
});

test("owner-only actions stay owner-only for members", async () => {
  const t = await setup();
  try {
    const m = await t.redeem((await t.invite("Amadeo")).invite);
    for (const credential of [
      { cookie: m.cookie },
      { token: m.body.memberToken },
    ]) {
      for (const [path, body] of [
        ["approve", { versionId: t.version.id, generation: 0 }],
        ["grants", { role: "reviewer" }],
        ["members", { name: "Eve" }],
        [`members/${m.body.memberId}/revoke`, {}],
      ] as const)
        assert.equal(
          (await t.call(`/journeys/${t.journey.id}/${path}`, body, credential))
            .status,
          403,
          path,
        );
    }
  } finally {
    t.close();
  }
});

test("a revoked member token and its sessions are refused everywhere", async () => {
  const t = await setup();
  try {
    const inv = await t.invite("Amadeo");
    const m = await t.redeem(inv.invite);
    const r = await t.call(
      `/journeys/${t.journey.id}/members/${inv.id}/revoke`,
      {},
      t.owner,
    );
    assert.equal(r.status, 200);
    for (const credential of [
      { cookie: m.cookie },
      { token: m.body.memberToken },
    ]) {
      assert.equal(
        (await t.call(`/journeys/${t.journey.id}`, undefined, credential))
          .status,
        401,
      );
      assert.equal(
        (
          await t.call(
            `/journeys/${t.journey.id}/comments`,
            {
              versionId: t.version.id,
              stepId: "home",
              text: "Still here?",
              anchor: { kind: "screen" },
            },
            credential,
          )
        ).status,
        401,
      );
    }
    assert.equal(
      (await t.call("/members/sign-in", { token: m.body.memberToken })).status,
      401,
    );
  } finally {
    t.close();
  }
});

test("a pending invite can be revoked before it is redeemed", async () => {
  const t = await setup();
  try {
    const inv = await t.invite("Amadeo");
    await t.call(
      `/journeys/${t.journey.id}/members/${inv.id}/revoke`,
      {},
      t.owner,
    );
    assert.equal((await t.redeem(inv.invite)).status, 401);
  } finally {
    t.close();
  }
});

test("a journey A member token is refused on journey B", async () => {
  const t = await setup();
  try {
    const other = (await (
      await t.call("/journeys", { title: "Other" }, t.owner)
    ).json()) as any;
    const m = await t.redeem((await t.invite("Amadeo")).invite);
    for (const credential of [
      { cookie: m.cookie },
      { token: m.body.memberToken },
    ]) {
      assert.equal(
        (await t.call(`/journeys/${t.journey.id}`, undefined, credential))
          .status,
        200,
      );
      assert.equal(
        (await t.call(`/journeys/${other.id}`, undefined, credential)).status,
        403,
      );
    }
  } finally {
    t.close();
  }
});

test("an invite older than 7 days is refused", async () => {
  const t = await setup();
  try {
    const inv = await t.invite("Amadeo");
    assert.equal(inv.inviteExpiresAt - inv.createdAt, 7 * 86400000);
    const past = Date.now() - 7 * 86400000 - 1000;
    t.store.db
      .prepare(
        "UPDATE member_grants SET created_at=?, invite_expires_at=? WHERE id=?",
      )
      .run(past, past + 7 * 86400000, inv.id);
    assert.equal((await t.redeem(inv.invite)).status, 401);
  } finally {
    t.close();
  }
});

test("after logout the member token opens a new session for the same member", async () => {
  const t = await setup();
  try {
    const inv = await t.invite("Amadeo");
    const m = await t.redeem(inv.invite);
    await t.call("/logout", {}, { cookie: m.cookie });
    assert.equal(
      (await t.call("/session", undefined, { cookie: m.cookie })).status,
      401,
    );
    const signIn = await t.call("/members/sign-in", {
      token: m.body.memberToken,
    });
    assert.equal(signIn.status, 200);
    const cookie = t.cookieOf(signIn);
    assert.notEqual(cookie, m.cookie);
    const session = (await (
      await t.call("/session", undefined, { cookie })
    ).json()) as any;
    assert.equal(session.role, "member");
    assert.equal(session.memberId, inv.id);
    assert.equal(session.name, "Amadeo");
    assert.equal(
      (await t.call("/members/sign-in", { token: "not-a-token" })).status,
      401,
    );
  } finally {
    t.close();
  }
});

test("a grant records when its member linked a Loop", async () => {
  const t = await setup();
  try {
    const inv = await t.invite("Amadeo");
    const m = await t.redeem(inv.invite);
    assert.equal(m.body.linkedLoopAt, null);
    t.store.markLinkedLoop(inv.id);
    const at = t.store.memberGrant(inv.id)!.linkedLoopAt;
    assert.ok(at);
    t.store.markLinkedLoop(inv.id);
    assert.equal(t.store.memberGrant(inv.id)!.linkedLoopAt, at);
    const session = (await (
      await t.call("/session", undefined, { cookie: m.cookie })
    ).json()) as any;
    assert.equal(session.linkedLoopAt, at);
  } finally {
    t.close();
  }
});

test("the owner client creates an invite link that redeems once", async () => {
  const { Client } = await import("../src/cli/client.js");
  const store = new Store(":memory:");
  const options = { store, secret: "owner", origin: "" };
  const server = createServer(options).listen(0);
  try {
    const base = `http://localhost:${(server.address() as { port: number }).port}`;
    options.origin = base;
    const journey = store.createJourney("Shared");
    const g = await new Client(base, undefined, "owner").inviteMember(
      journey.id,
      "Amadeo",
    );
    assert.equal(g.link, `${base}/#invite=${g.invite}`);
    assert.equal(store.redeemInvite(g.invite).grant.name, "Amadeo");
  } finally {
    server.close();
    store.close();
  }
});
