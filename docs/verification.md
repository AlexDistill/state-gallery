# First-release local verification

For the subsequent integration/debugging round, see [the 0.2.0 verification receipt](reviews/2026-10-11-integration-debug.md).

Implementation location: `/Users/alexryan/Documents/work/distill/state-gallery`, branch `codex/initial-release`. Canonical plan: `docs/plans/2026-10-11-1035-feat-shared-journey-review-plan.md`. All U1–U7 were implemented in the native worker context. The plan and its review receipt were not edited. No commits, PRs, publications or deployments were performed by this worker; the caller owns authoritative review, verification and shipping.

## Executed results

- `npm ci` equivalent dependency installation completed with pinned dependencies and committed-ready lockfile; initial dependency audit findings were removed by selecting patched sharp, Vite and Playwright releases.
- `npm run typecheck`: passed.
- `npm run format:check`: passed after formatting.
- `npm test`: **13 passed** after the caller's logout recovery fix, covering immutable versions, atomic failures, persistence across database reopen, generation-bound decisions, unseen replies, superseded requests, late/removed-step feedback, exact request snapshots, idempotency, approval history, role/origin restrictions, protected image access, revocation/expiry, decoded raster validation, adapter paths/inventory, and expired/revoked-session logout.
- `npm run build`: passed, producing the Node runtime, public client, CLI, capture/import modules and declarations.
- `npm run test:e2e`: **3 passed** against a real production server and local Chromium. The principal test creates/reorders mixed visuals in the browser, joins two reviewer contexts, persists a normalized region and reply through reload/resize, exports actual images and frozen evidence via CLI, submits and replays a successor, compares versions, resolves feedback, approves, reads the authorized build brief, and proves revocation. Additional tests prove real caller-owned capture outcomes and failed-upload recovery/retained images/stale drafts.
- `npm run smoke:package`: passed from a fresh temporary external consumer installing an actual npm tarball. The built CLI runs and the public helper captures a real Playwright browser. The tarball contains the server, CLI, helper, schema, declarations and built client.
- `node examples/capture/run.mjs`: passed for two unrelated synthetic project shapes (`shop` and `notes`), each producing two complete real captures.
- `npm audit`: zero vulnerabilities after patched dependencies were installed. The caller also inspected `npm audit --omit=dev`: zero production vulnerabilities.
- `npm pack --dry-run --json`: inspected; runtime files and public client included, local data/secrets/evidence excluded.

Node observed by this worker's shell: **22.16.0**. Built-in SQLite works and emits its experimental warning on this Node release. No paid provider or live generation was called.

## Evidence and inspection

Local gallery: `/Users/alexryan/Documents/work/distill/state-gallery/.evidence/index.html`.

Preview: `http://localhost:4199`, serving a synthetic Fieldwork journey. The owner credential is supplied privately through the preview process environment, not recorded in this receipt or Git. The preview data lives in ignored `.data`.

The gallery includes desktop/mobile overview, annotation, comparison, access-failure, revision-request and approved states, plus readable seeded-demo overview/detail screens. `.secret` controls are masked in test screenshots. No reviewer links or agent tokens are intentionally published. These pictures are evidence, not Alex's approval.

The caller manually inspected the seeded desktop overview and 390px mobile overview: screens remain readable together, controls fit, and navigation scrolls horizontally. The worker inspected seeded desktop detail and mobile overview raster evidence. An initially oversized phone detail was corrected to intrinsic image width with a usable sticky discussion pane. Historical steps compare by stable ID; unmatched steps remain explicit.

Security-focused implementation inspection and tests cover journey scope on every metadata/image read, separate bearer/session roles, authoritative grant revocation at join and read, owner-only decisions, same-origin browser writes, decoded bounded raster input at server/CLI/adapter boundaries, path/symlink containment, immutable content, and compare-and-swap resolution/approval. The caller completed its inline final review; see [review receipt](reviews/2026-10-11-code-review.md).

## Caller final verification

After the implementation worker froze edits, the caller reproduced the logout recovery defect with a real HTTP test (401 instead of 200 for an expired session). Removing the valid-identity requirement from logout allows expired/revoked sessions to clear their cookie while preserving origin checks and session deletion. The regression then passed for both cases.

The caller reran typecheck, formatting, all 13 unit/integration tests, production build, all 3 browser E2E tests, and the packed external-consumer smoke after this fix; all passed. The caller inspected the desktop and mobile overview, desktop annotation/detail, version comparison, approved state and access-failure evidence. This is one-context code/visual review, not an independent cross-model audit. No product approval was issued for Alex.

## Per-unit evidence

No tests or implementation existed at intake; `git status` was clean. Initial discovery inspected the plan's named test scenarios and the empty repository. Newly written tests were used throughout; no pre-existing test was claimed as inspected or passed.

| Unit | Evidence strategy and actual observations                                                                                                                                                                                                                                                                                                                                                                                            | Verification                                                                     |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| U1   | Wrote a focused domain test before production code. Its red run failed with missing `src/server/domain.js`; the earlier attempted run encountered esbuild while npm installation was still completing and is not semantic red evidence. Added broader persistence/atomicity/version/history tests during integration.                                                                                                                | Domain tests and full suite pass.                                                |
| U2   | Wrote real HTTP role/origin/access test before HTTP implementation; red run failed with missing `src/server/http.js`. Expanded it to actual image bytes, revoked/expired grants, cross-journey reads, agent restrictions and script/corrupt images.                                                                                                                                                                                  | HTTP tests and full suite pass.                                                  |
| U3   | Built new browser scaffolding before integrated E2E rather than claiming a semantic proof-first UI test. Replaced this deliberate bootstrap exception with full browser authoring/reordering/version/viewport checks and caller visual inspection. A later recovery regression actually failed because unused rejected asset bytes were reuploaded; fixed by submitting only currently declared assets, then observed the test pass. | Build, typecheck, desktop/mobile evidence and E2E pass.                          |
| U4   | Used domain validation plus real browser collaboration as integration evidence. No pre-implementation semantic red is claimed. Region coordinates survived reload and a phone-to-desktop resize; two reviewer sessions and replies were exercised.                                                                                                                                                                                   | Domain/HTTP tests and E2E pass.                                                  |
| U5   | Added domain/HTTP tests and real CLI/browser flow after the integrated boundary existed. No pre-implementation semantic red is claimed. Tested stale approvals/resolutions, superseded requests, identical/conflicting submission keys, late feedback, removed-step context and historical authorization. CLI export downloaded actual bytes.                                                                                        | Full suite, main browser loop and packed CLI pass.                               |
| U6   | Wrote adapter/path tests before modules existed; red run failed with missing importer module. Inspected the actual source formats read-only. Synthetic tests retain Content Factory unknown coverage, Sigma expected gaps and an 833-key inventory with selectable groups. A real helper run retained selected failure and unselected missing steps.                                                                                 | Adapter tests, real Playwright E2E, two project examples and packed helper pass. |
| U7   | Nonbehavioral docs/packaging/configuration used production build, package inspection, external consumer smoke and evidence gallery as replacement verification. No proof-first claim for prose/config.                                                                                                                                                                                                                               | All gates pass; native production server and external packed consumer verified.  |

## Scope and operational limitations

Public hosting, package-registry publication, real external client sharing, verified third-party identity, and Docker runtime execution were **not performed**. CI configuration is provided; no hosted CI run is claimed. The full browser collaboration is verified locally against a real server. Docker/self-hosting instructions are provided for the operator's later action.

Content Factory and Sigma remain read-only references. Their own app suites/live generation are not part of this release. Newly generated synthetic fixtures replace any private source/client data. Content Factory's `run.json` cannot establish original expected coverage; its adapter explicitly reports unknown coverage. Sigma retains expected inventory, uses current viewport captures and supports key-prefix groups for larger image payloads. A single JSON import remains bounded to 40 MB / 2,000 steps.

The owner may import an initial version via browser or CLI with the private owner login secret. Revision agents receive only journey-scoped credentials and must submit against an explicit owner request. This is an intentional role boundary, documented in the agent guide.
