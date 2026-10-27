import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Store } from "../src/server/domain.js";
import { createServer } from "../src/server/http.js";
import { recordTurn, shelve, type Actor } from "../src/server/notes.js";
import { TurnsView } from "../src/client/Turns.js";

const image = {
  bytes: Buffer.from("img"),
  mime: "image/png",
  width: 10,
  height: 10,
};

async function fixture() {
  const store = new Store(":memory:");
  const j = store.createJourney("Shared");
  const v1 = store.submit(
    j.id,
    {
      schemaVersion: 1,
      steps: [
        {
          id: "home",
          title: "Home",
          kind: "mockup",
          viewport: { width: 10, height: 10 },
          image: "home.png",
        },
      ],
    },
    { "home.png": image },
    "v1",
  );
  const g = store.inviteMember(j.id, "Alex");
  const { token } = store.redeemInvite(g.invite);
  const alex: Actor = { role: "member", memberId: g.id };
  const turn = (
    loopTurnId: string,
    at: number,
    extra: Record<string, unknown>,
  ) =>
    recordTurn(
      store,
      j.id,
      {
        loopTurnId,
        parentIds: [],
        inputs: [{ title: `Brief for ${loopTurnId}` }],
        outputs: [],
        reactionNoteIds: [],
        versionId: null,
        notAVersionReason: null,
        ...extra,
      },
      alex,
      at,
    );
  turn("t1", 1000, {
    outputs: [{ title: "Home screen", kind: "image" }],
    versionId: v1.id,
  });
  turn("t2", 2000, {
    outputs: [
      { title: "Walkthrough video", kind: "other" },
      { title: "Copy notes", kind: "other" },
    ],
    reactionNoteIds: ["note-x"],
  });
  turn("t3", 3000, {
    outputs: [{ title: "Home screen v2", kind: "image" }],
    notAVersionReason:
      "Another version was added from the same parent first. Pull, then redo this turn from the latest version.",
  });
  shelve(store, j.id, { itemId: "old-hero", reason: "Too loud" }, alex, 1000);
  shelve(
    store,
    j.id,
    { itemId: "dark-mode", reason: "Later, after launch" },
    alex,
    5000,
  );
  shelve(
    store,
    j.id,
    { itemId: "carousel", reason: "Nobody swipes" },
    alex,
    3000,
  );

  const app = createServer({ store, secret: "s", origin: "http://x" });
  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", r));
  const base = `http://localhost:${(server.address() as { port: number }).port}/api/journeys/${j.id}`;
  const get = async (path: string) => {
    const r = await fetch(base + path, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(r.status, 200);
    return r.json() as Promise<any>;
  };
  const { turns } = await get("/turns");
  const { shelf } = await get("/shelf");
  server.close();
  return {
    html: renderToStaticMarkup(
      createElement(TurnsView, {
        turns,
        shelf,
        versions: store.get(j.id).versions,
        notes: [],
      }),
    ),
  };
}

test("three pushed turns render in order; a video output is a listed item, not a step", async () => {
  const { html } = await fixture();
  const order = ["Brief for t1", "Brief for t2", "Brief for t3"].map((s) =>
    html.indexOf(s),
  );
  assert.ok(order.every((i) => i >= 0));
  assert.deepEqual(
    [...order].sort((a, b) => a - b),
    order,
  );
  assert.match(html, /Turn 1 · Alex[\s\S]*Became version 1 · 1 image as steps/);
  assert.match(html, /<li class="turn-output">Walkthrough video<\/li>/);
  assert.match(html, /<li class="turn-output">Copy notes<\/li>/);
  assert.match(html, /Note note-x/);
});

test("a not-a-version turn shows its reason", async () => {
  const { html } = await fixture();
  assert.match(
    html,
    /Not a version<\/span> Another version was added from the same parent first/,
  );
  assert.match(html, /1 image, not shown as a version/);
});

test("the shelf lists items with reasons, newest first", async () => {
  const { html } = await fixture();
  const order = ["dark-mode", "carousel", "old-hero"].map((s) =>
    html.indexOf(`<strong>${s}</strong>`),
  );
  assert.ok(order.every((i) => i >= 0));
  assert.deepEqual(
    [...order].sort((a, b) => a - b),
    order,
  );
  assert.match(html, /Later, after launch/);
  assert.match(html, /Nobody swipes/);
});
