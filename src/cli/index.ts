#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Client, loadManifest } from "./client.js";
import { importContentFactory, importSigma } from "../importers/index.js";
const [command, ...args] = process.argv.slice(2);
async function main() {
  if (command === "help" || !command) {
    console.log(
      "State Gallery\nvalidate <manifest>\nimport <journey> <manifest> <submission-key>\nsubmit <journey> <manifest> <submission-key>\nexport <journey> <request-id> <directory>\nbuild-brief <journey>\nadapt-content-factory <gallery-directory> <output-manifest> [key-prefix]\nadapt-sigma <gallery-directory> <output-manifest> [key-prefix]\nCredentials: STATE_GALLERY_URL, STATE_GALLERY_TOKEN (agent) or STATE_GALLERY_OWNER_SECRET (owner). Never put credentials in arguments.",
    );
    return;
  }
  if (command === "validate") {
    const m = await loadManifest(resolve(args[0]));
    console.log(
      `Valid: ${m.manifest.steps.length} steps · ${m.manifest.coverage} coverage`,
    );
    return;
  }
  if (command?.startsWith("adapt-")) {
    const importer =
      command === "adapt-sigma"
        ? importSigma
        : command === "adapt-content-factory"
          ? importContentFactory
          : null;
    if (!importer) throw new Error("Unknown adapter");
    const file = resolve(args[1]);
    const m = await importer(resolve(args[0]), args[2]);
    const { dirname, relative } = await import("node:path");
    m.steps = m.steps.map((s) => ({
      ...s,
      image: s.image
        ? relative(dirname(file), resolve(args[0], s.image))
        : undefined,
    }));
    if (m.steps.some((s) => s.image?.split("/").includes("..")))
      throw new Error(
        "Write the manifest inside the input gallery directory so image paths remain contained",
      );
    await writeFile(file, JSON.stringify(m, null, 2));
    console.log(file);
    return;
  }
  const c = new Client(
    process.env.STATE_GALLERY_URL ?? "http://localhost:4199",
    process.env.STATE_GALLERY_TOKEN,
    process.env.STATE_GALLERY_OWNER_SECRET,
  );
  if (command === "export") {
    await c.exportRequest(args[0], args[1], resolve(args[2]));
    console.log(`Exported request to ${resolve(args[2])}`);
  } else if (command === "import" || command === "submit") {
    const payload = await loadManifest(resolve(args[1]));
    const v = await c.request(
      `/journeys/${encodeURIComponent(args[0])}/versions`,
      { ...payload, submissionKey: args[2] },
    );
    console.log(JSON.stringify({ versionId: v.id }));
  } else if (command === "build-brief") {
    console.log(
      JSON.stringify(
        await c.request(`/journeys/${encodeURIComponent(args[0])}/build-brief`),
        null,
        2,
      ),
    );
  } else throw new Error("Unknown command. Run state-gallery help.");
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
