# Integrate State Gallery with an app

State Gallery runs beside your app. Your project owns its browser, authentication, fixtures and screen transitions. The portable manifest carries the resulting images into the same review loop as uploaded mockups.

## Install and capture your first screen

Requires Node 22.13+ and Git. From your app directory:

```sh
npm install --save-dev github:AlexDistill/state-gallery playwright
npx playwright install chromium
npx state-gallery init
STATE_GALLERY_APP_URL=http://localhost:3000 node state-gallery.capture.mjs
```

The Git dependency builds its runtime automatically. `init` writes one editable `state-gallery.capture.mjs` and preserves an existing file. It creates no framework dependency or changes to your app's package scripts. Add your setup and named screens to its `steps` array. Each `show(page)` can navigate, click, open a modal or install a fixture; each optional `check(page)` verifies readiness before capture.

The generated `.mjs` script works in both CommonJS and ESM projects. The Node client also supports native `require("@state-gallery/review")` on the declared Node runtime.

Captures and `manifest.json` go into `state-gallery-captures/`. Failed and unselected screens stay in the inventory. Add that directory to your app's `.gitignore` when the captures should stay local. Add a package script such as `"review:capture": "node state-gallery.capture.mjs"` if you want a repeatable project command.

Already using Playwright? Keep your existing Page and call `captureJourney` inside your test or capture script:

```ts
import { captureJourney } from "@state-gallery/review/capture";

await captureJourney(page, {
  title: "Checkout",
  directory: "./state-gallery-captures",
  steps: [
    {
      id: "cart",
      title: "Review the cart",
      transition: "Continue to delivery",
      viewport: { width: 390, height: 844 },
      show: async (page) => {
        await page.goto(`${appUrl}/cart`);
      },
      check: async (page) => {
        await page.getByRole("heading", { name: "Your cart" }).waitFor();
      },
    },
  ],
  testInfo, // optional Playwright Test attachments; omit in ordinary scripts
});
```

Plain `playwright`, `playwright-core`, and `@playwright/test` Pages are supported. Browser installation and project setup remain under your control.

## Start a review studio and import

In another terminal:

```sh
npx state-gallery serve
```

The installed CLI stores its local studio at `~/.state-gallery/data`, outside the host repository. Open the logged URL, read the logged private owner-secret file locally and sign in. `STATE_GALLERY_DATA` overrides the storage location; the checkout's `npm start` retains its `.data` default. See [self-hosting](self-hosting.md) for an HTTPS shared server.

Set `STATE_GALLERY_URL` and the owner credential in your private environment. Use one credential at a time: `STATE_GALLERY_OWNER_SECRET` for owner setup, or a scoped `STATE_GALLERY_TOKEN` for a revision agent. Then:

```sh
npx state-gallery create "Checkout"
npx state-gallery journeys
npx state-gallery import JOURNEY_ID ./state-gallery-captures/manifest.json first-capture
```

`create` prints JSON with the new journey ID. `journeys` lists the journeys visible to the credential. Initial import creates version one. Open it in the studio to annotate and invite reviewers.

## Submit from Node or a CI capture job

The public Node client handles the same validated API as the browser and CLI. It works from any framework that can produce the manifest and raster files; no Playwright dependency is required for mockup or screenshot imports. With a caller-owned `page` and configured `appUrl`, a capture job can freeze its parent before capturing:

```ts
import { Client } from "@state-gallery/review";
import { captureJourney } from "@state-gallery/review/capture";
import { randomUUID } from "node:crypto";

const client = Client.fromEnvironment();
const journey = await client.getJourney(process.env.STATE_GALLERY_JOURNEY_ID!);
const submissionKey = randomUUID();

await captureJourney(page, {
  title: journey.title,
  directory: "./state-gallery-captures",
  steps: [
    {
      id: "checkout",
      title: "Checkout",
      viewport: { width: 390, height: 844 },
      show: async (page) => {
        await page.goto(`${appUrl}/checkout`);
      },
    },
  ],
});

const version = await client.submitManifest(
  journey.id,
  "./state-gallery-captures/manifest.json",
  submissionKey,
  { parentId: journey.currentId ?? undefined },
);
console.log(version.id);
```

For an owner capture job, read and retain the parent before capturing. If another version arrives, submission conflicts so you can review the new context. Keep the same parent, submission key, manifest and images when retrying a lost response; generating a new key creates a distinct submission. Persist those values with your job if recovery must survive process restarts.

A revision agent exports an explicit owner request, keeps its parent/request IDs and submits the edited manifest. It cannot create a journey or approve a build. Use `client.getRevisionRequest`, `client.exportRequest`, `client.submitManifest` and `client.getBuildBrief`, or the equivalent [agent CLI commands](agent-integration.md). `exportRequest` accepts a new or empty destination, preserves JPEG/WebP/PNG formats and refuses to overwrite existing revision work.

`getBuildBrief(journeyId).authorized` reports current owner approval. Reading it or submitting an agent response never grants approval. Browser comments, owner decisions and agent submissions all enter the same domain rules.

## Other screenshot sources

Image generation tools, manual exports and non-Playwright capture systems can write the same JSON manifest. Use `manifestSchema` from `@state-gallery/review/manifest` to validate it, then `Client.submitManifest` or `state-gallery import`. PNG, JPEG and WebP paths are relative to the manifest. The readers decode declared images and reject escaping paths before upload.

See [capture format and adapters](capture.md) for mixed mockups/captures, gaps, complete inventory, and the Content Factory/Sigma adapters. See [agent integration](agent-integration.md) for revision snapshots, response mappings and idempotency.
