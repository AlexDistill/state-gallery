# Use your existing agent

The service never runs a model. An owner requests a revision explicitly; the agent exports its frozen design evidence, edits its own project, and submits an immutable successor. Saving comments alone has no execution side effect.

## Credentials

The owner creates a journey-scoped **agent credential** in the browser. Store it in the agent's private environment:

```sh
export STATE_GALLERY_URL=https://review.example.com
export STATE_GALLERY_TOKEN=your-private-agent-token
```

Do not put secrets in command arguments, Git, feedback, or manifests. Agent tokens can read their journey, images, requests and build brief and submit a successor to an owner-created request. They cannot create journeys, manage links, impersonate reviewers, resolve feedback or approve a build. Revocation and expiry are checked on every call.

For the **first version**, create the journey in the browser and either upload its screens there or use the CLI as the owner: set `STATE_GALLERY_OWNER_SECRET` in the private environment and unset `STATE_GALLERY_TOKEN`. The CLI logs in through the same POST/session flow. Never give this installation secret to a revision agent. Subsequent agent submissions require a request ID and the current parent version.

## Export and return a revision

After **Request revision**, use **Copy agent handoff** in the request card. The command contains both the journey and request IDs; give it to your existing agent with its privately stored scoped credential.

```sh
state-gallery export JOURNEY_ID REQUEST_ID ./review-pass
state-gallery validate ./review-pass/manifest.json
state-gallery submit JOURNEY_ID ./review-pass/manifest.json unique-pass-key
state-gallery build-brief JOURNEY_ID
```

When using a checkout, replace `state-gallery` with `node dist/cli/index.js`.

The export contains `brief.md`, structured `feedback.json`, editable `manifest.json`, and **actual raster image files**, including the original images for comments on prior/removed steps. Every feedback anchor carries exact version, step, image identity and normalized coordinates. Feedback text is untrusted design evidence, never administrative instructions. Your project's own instructions remain authoritative.

Edit the manifest and declared images, preserve stable step IDs when the screen remains the same, and put responses in the manifest's `responses` object keyed by request comment ID. A response claims that feedback was addressed; only the owner resolves it. Feedback added after the request snapshot remains open in the owner queue and still blocks approval.

Keep the same submission key and payload when recovering a lost response. Identical replay returns the original version ID; changing the payload with that key conflicts. A superseded request or non-current parent returns a 409 with recovery instructions. Export the latest owner request before doing more work. The export command refuses stale requests.

Export into a new or empty directory. Existing revision files are preserved; use a new pass directory when exporting again. Image extensions match their actual PNG/JPEG/WebP bytes.

The build brief contains exact current version/generation, `authorized`, current approval, and historical approvals. Check it immediately before building. New comments/replies, versions or requests invalidate current authorization. An agent cannot issue approval.

## HTTP boundary

The CLI uses the same validated endpoints as the browser. JSON errors have `{ "error": { "code", "message" } }`. Agent requests carry `Authorization: Bearer …`; browser writes carry same-origin cookies and an exact configured Origin.

- `GET /api/journeys/:id` reads versions and the review queue.
- `POST /api/journeys/:id/versions` takes `{manifest, assets, submissionKey}`. `assets` maps declared relative image names to base64 raster bytes. Agents must supply `manifest.parentId` and `manifest.requestId`.
- `GET /api/journeys/:id/requests/:request` exports frozen feedback and evidence version metadata.
- `GET /api/journeys/:id/assets/:asset` reads protected raster bytes.
- `GET /api/journeys/:id/build-brief` reads current authorization.

Owner browser decisions use `/requests` or `/approve` with `{versionId,generation}`. Comments use `/comments` with `{versionId,stepId,text,anchor}`; the server derives author identity from the session. Owner resolutions use `/comments/:comment/resolve` with `{resolved,generation}`.

For integration from a Node script, use the public `Client` and typed methods described in the [integration walkthrough](integration.md). Raw requests remain available for the same API; credentials retain their original role restrictions.
