# State Gallery

Review a product as a journey of screens. Mix early mockups with captures from a working prototype, pin feedback to the exact image, request a revision from your existing agent, and approve a specific version for building.

State Gallery is a self-hostable TypeScript application with a React client, a Node server, SQLite persistence, a CLI, and a portable Playwright capture helper. No model account or generation provider is required.

## Run locally

Requires Node **22.13 or later**, npm, and persistent disk.

```sh
npm ci
npm run build
npm start
```

Open <http://localhost:4199>. On first start, the service writes a random owner secret to `.data/owner-secret` with private permissions. Read that file locally and enter its value into the login form. It is not printed in server logs. Do not commit or share it.

```sh
cat .data/owner-secret
```

For a synthetic journey with three readable example screens:

```sh
npm run demo
npm start
```

The demo preserves existing data and uses newly generated local raster assets. Its Fieldwork screens are invented, not client work. Open the demo, leave feedback, create an agent credential, request a revision, export it with the CLI, submit a successor, resolve feedback, and approve. The same complete loop is automated by `npm run test:e2e`.

## Review together

Create a journey, add screens, arrange their order, and submit an immutable version. Each step carries a stable ID, purpose, transition, visual type, viewport, and provenance. A gap remains visible when a screen does not exist yet. Add a version to preserve the earlier version and its discussions; unchanged visuals are carried into the new draft.

Create a reviewer link, choose its expiry, and copy it to a collaborator. The secret travels in the URL fragment, is exchanged through a POST, and is removed from the address bar. A guest selects a display name; this is **not verified identity**. Anyone holding the link can join until its expiry or revocation. Revocation stops existing sessions and protected image reads too.

Open a screen and choose a whole-screen note, pin, or region. Coordinates belong to that exact version and image. Discussion is shared after refresh or polling every four seconds. An owner can resolve feedback; an agent's response is only a claim of completion.

Request revision explicitly. Comments alone never execute an agent. Export the request for your existing agent, review its submitted successor, compare stable step IDs, and resolve all open feedback (including earlier versions). Approval binds the current version and review generation. New feedback, replies, revision requests, or versions remove current authorization while preserving its historical receipt.

## Integrate a project

Install directly from GitHub in your app:

```sh
npm install --save-dev github:AlexDistill/state-gallery playwright
npx playwright install chromium
npx state-gallery init
STATE_GALLERY_APP_URL=http://localhost:3000 node state-gallery.capture.mjs
```

Run `npx state-gallery serve` in another terminal to open a local review studio. Use the CLI to create/import journeys, or the typed Node client to submit them from a project script. Your existing Playwright Page remains under your app's control; ordinary Playwright and Playwright Test are both supported.

See the [integration walkthrough](docs/integration.md), [capture and gallery imports](docs/capture.md), [agent CLI/API integration](docs/agent-integration.md), and [self-hosting](docs/self-hosting.md). Git installation builds the package automatically; `npm pack` produces a built tarball for offline/local installation. The package is named `@state-gallery/review`; npm registry publication is not claimed.

## Verify and contribute

```sh
npx playwright install chromium
npm run typecheck
npm run format:check
npm test
npm run build
npm run test:e2e
npm run smoke:package
```

See [CONTRIBUTING.md](CONTRIBUTING.md) and [verification evidence](docs/verification.md). MIT licensed. The first release serves one trusted studio with one installation owner; it does not provide SaaS tenancy, verified accounts, automatic agent dispatch, or hosted generation.
