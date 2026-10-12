# Integration debugging and verification

## Debug Summary

**Problem:** A fresh app could not reliably install, typecheck or run State Gallery. Some CLI errors hid the useful cause, and edge-case names broke submission replay.

**Root Cause:**

- `package.json` exported ignored build output but had no Git-install build lifecycle. A fresh Git dependency installed successfully, then importing the capture helper failed with `ERR_MODULE_NOT_FOUND`. `prepare.mjs` now builds source checkouts; packed installs reuse their included runtime. Build logs go to stderr so `npm pack --json` remains valid JSON.
- `src/capture/playwright.ts:1` imported Page/attachment types from the test runner. A plain Playwright TypeScript consumer failed with TS2307. The helper now uses `playwright-core` Page types and a structural attachment interface. The Node client entry has no optional browser-type dependency.
- `src/server/index.ts:33` used URL.pathname as a filesystem path. A directory containing spaces retained `%20`, so the installed server returned 404 for its UI. `fileURLToPath` now resolves the actual path.
- `src/cli/client.ts:163` assumed every error response was JSON. An HTML 502 became a JSON syntax error. Errors now retain their HTTP status and useful API message or status text.
- `src/cli/client.ts:175` exported all rasters with `.png` names and overwrote an existing destination. A JPEG export had the wrong extension. Exports now decode the raster format, use its extension, accept only a new/empty real directory, and create files exclusively.
- `src/cli/client.ts:142` checked an empty cookie independently in every concurrent request. Twenty parallel reads sent twenty logins, risking the server's fifteen-attempt rate limit. Requests now share one pending login; the same probe sends one login. Mutations are never automatically retried.
- `src/cli/index.ts:62` previously resolved missing arguments before validation, producing an internal `paths[0]` error. Commands now expose their usage before filesystem or HTTP work.
- String-keyed image dictionaries and submission records treated `__proto__` as an object setter. The CLI dropped the declared image, the HTTP path omitted its bytes from the submission digest, and persisted submission replay lost the key. Null-prototype image dictionaries, own-property asset checks and computed data-property submission records preserve those names. Three regressions failed before the fix and pass after it; changed image retries now conflict and identical retries return the saved version.

**Recommended Tests:** Keep the actual packed/source consumer smoke rather than relying on the working checkout. Its consumer typechecks without the test runner, loads ESM/CommonJS, serves the UI from a path containing spaces, executes the generated starter against a real unrelated app, creates/imports a journey, submits a successor through the client, and compiles a separate Node-only app without Playwright. Focused HTTP/client/domain tests own proxy errors, concurrent login, export identity/preservation, argument errors and special-name idempotency.

**Fix:** Version 0.2.0 provides Git installation, a public typed Node client, `serve`, `init`, `create` and `journeys` commands, the generated capture starter and an integration walkthrough. Existing manifest, capture, role, review and approval rules remain the integration boundary.

**Prevention:** The CI package smoke now exercises fresh installation and a complete foreign-app capture/import path. The original browser/API/CLI review loop remains in the required checks.

**Confidence:** High for the tested Node 22 runtime and local HTTP/browser/package boundaries. Docker runtime execution and public hosting were not exercised in this round.

## Verification

- `npm run typecheck`: passed.
- `npm run format:check`: passed.
- `npm test`: 20 passed.
- `npm run build`: passed.
- `npm run test:e2e`: 3 passed after the final dictionary fix.
- `npm run smoke:package`: packed and fresh Git consumers passed after the final fix, including plain Playwright, ESM/CommonJS, path spaces and Node-only TypeScript.
- Existing GitHub main CI was green at intake; the new branch's GitHub result belongs to its PR checks.

All data was synthetic. Content Factory and Sigma were read-only references and received no edits. No issue of record was supplied or created.

## Post-Fix Quality

**Scope:** Clean pre-fix tree at `3cc44d98337bc3974559bbb698bc6c811379162f`; only this round's files on `codex/integration-debug`.

**Simplify:** Reuse, quality and efficiency passes ran sequentially in the main context. One quality improvement kept the optional capture helper out of the Node-client entry graph; existing callers were checked and the new unshipped consumer examples updated. No speculative abstraction or performance rewrite was added.

**Review:** Targeted manual correctness, API-contract, security, data integrity and testing review, following the user's preference for review in the main context. This was not an independent or cross-model audit. Review found and resolved the concurrent-login and special-name issues described above.

**Residuals:** No remaining actionable findings within the verified scope. The CI result is reported by GitHub; final merge remains the owner's decision.

**Re-verification:** Full local checks and both installation paths passed after the final changes. The existing three browser flows still pass.
