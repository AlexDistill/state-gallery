# Capture or import a journey

A portable manifest is versioned JSON. Image paths are relative to the manifest's own directory and must remain inside it after symlink resolution. Only declared PNG/JPEG/WebP files are read. The CLI never uploads browser storage or unrelated application files.

```json
{
  "schemaVersion": 1,
  "title": "First checkout",
  "coverage": "complete",
  "expected": ["welcome"],
  "steps": [
    {
      "id": "welcome",
      "title": "Welcome",
      "purpose": "Introduce the collection",
      "transition": "Explore the products",
      "kind": "capture",
      "viewport": { "width": 390, "height": 844 },
      "outcome": "captured",
      "image": "welcome.png",
      "provenance": "Project-owned Playwright setup"
    }
  ]
}
```

A `mockup` uses the same image/viewport fields. A deliberate `gap` has no image and `missing` outcome. A failed capture remains `failed` with its failure message in provenance. Complete coverage requires an explicit unique expected inventory, an exact matching step set, and a successful image for every step. `partial` retains failed/unselected inventory; `unknown` means the source did not supply expected coverage.

Raster images are decoded, limited to 10 MB / 40 megapixels / 20,000 pixels per dimension, and cannot be SVG/HTML or animated multi-page images. A submission is bounded to 40 MB JSON and 2,000 steps. For large galleries, select a meaningful key prefix and submit smaller journeys; these are review experiences, not storage dumps.

## Playwright helper

Install a packed State Gallery package and Playwright in your project. The helper accepts your existing Page; authentication, fixtures, readiness and navigation remain your responsibility. It settles document fonts and disables animations before capture. It does not discover states or run code in the review server.

```ts
import { captureJourney } from "@state-gallery/review/capture";

await captureJourney(page, {
  title: "First checkout",
  directory: "./captures/checkout",
  steps: [
    {
      id: "welcome",
      title: "Welcome",
      viewport: { width: 390, height: 844 },
      show: async (page) => {
        await page.goto(projectUrl);
      },
      check: async (page) => {
        await expect(page.getByRole("heading")).toBeVisible();
      },
    },
  ],
  testInfo, // optional: attach PNGs to the host project's test report
});
```

`selected` optionally lists step IDs to run. The complete expected inventory is retained: unselected steps are missing and selected failures are failed. Neither can masquerade as a complete run. Inspect `coverage` and fail your own pipeline if complete capture is required. Run `node examples/capture/run.mjs` after building for two unrelated synthetic project shapes using real caller-owned browser pages.

## Existing gallery adapters

The adapters read the observed formats without changing either source app. Write the generated manifest **inside the input gallery directory**, then arrange/title its steps before owner import.

```sh
state-gallery adapt-content-factory ./gallery ./gallery/manifest.json
state-gallery adapt-content-factory ./gallery ./gallery/checkout.json checkout/
state-gallery adapt-sigma ./test-results ./test-results/manifest.json
state-gallery adapt-sigma ./test-results ./test-results/scenario.json scenario-name/
state-gallery validate ./gallery/manifest.json
state-gallery import JOURNEY_ID ./gallery/manifest.json unique-import-key
```

An optional key prefix selects a grouping from larger galleries. Sigma's observed 833-checkpoint inventory fits the 2,000-step manifest bound, but real raster payloads can exceed the upload bound; prefix groups make those journeys reviewable without dropping selected failures.

**Content Factory:** reads `run.json` entries (`path`, `file`, `comparison`, `outcome`). Uses current capture paths, not approved/diff images. Stable IDs derive from the original key; readable labels are derived, not recovered state prose. This file lists successful captures only and lacks full expected inventory/descriptions, so coverage is **unknown**, including when selecting a prefix. Add your project-owned expected inventory and missing steps deliberately if you need stronger coverage claims.

**Sigma:** reads `inventory.json` expected keys and recursively finds `capture.json` records. Key order is retained; scenario, phase, table and viewport kind become labels/tags. Selects each current viewport image; full-content images remain separate source evidence and are not confused with a predecessor/diff. Missing checkpoints become explicit gap steps and partial coverage. Missing declared images, duplicate/unknown keys, malformed records, traversal and escaping symlinks produce actionable errors before upload.

Adapters validate the complete selected image set and only upload declared assets. No credentials, raw application storage or source-project runtime is imported.
