#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { Client, loadManifest } from "./client.js";
import { importContentFactory, importSigma } from "../importers/index.js";
import { createCaptureStarter } from "./init.js";
const [command, ...args] = process.argv.slice(2);
const commands: Record<string, { usage: string; min: number; max: number }> = {
  serve: { usage: "serve", min: 0, max: 0 },
  init: { usage: "init [directory]", min: 0, max: 1 },
  journeys: { usage: "journeys", min: 0, max: 0 },
  create: { usage: "create <title>", min: 1, max: 1 },
  invite: { usage: "invite <journey> <display-name>", min: 2, max: 2 },
  validate: { usage: "validate <manifest>", min: 1, max: 1 },
  import: {
    usage: "import <journey> <manifest> <submission-key>",
    min: 3,
    max: 3,
  },
  submit: {
    usage: "submit <journey> <manifest> <submission-key>",
    min: 3,
    max: 3,
  },
  export: {
    usage: "export <journey> <request-id> <directory>",
    min: 3,
    max: 3,
  },
  "build-brief": { usage: "build-brief <journey>", min: 1, max: 1 },
  "adapt-content-factory": {
    usage:
      "adapt-content-factory <gallery-directory> <output-manifest> [key-prefix]",
    min: 2,
    max: 3,
  },
  "adapt-sigma": {
    usage: "adapt-sigma <gallery-directory> <output-manifest> [key-prefix]",
    min: 2,
    max: 3,
  },
};
async function main() {
  if (
    command === "help" ||
    command === "--help" ||
    command === "-h" ||
    !command
  ) {
    console.log(
      `State Gallery\n${Object.values(commands)
        .map((c) => c.usage)
        .join(
          "\n",
        )}\nCredentials: STATE_GALLERY_URL, STATE_GALLERY_TOKEN (agent) or STATE_GALLERY_OWNER_SECRET (owner). Never put credentials in arguments.`,
    );
    return;
  }
  const definition = commands[command];
  if (!definition) throw new Error("Unknown command. Run state-gallery help.");
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`Usage: state-gallery ${definition.usage}`);
    return;
  }
  if (args.length < definition.min || args.length > definition.max)
    throw new Error(`Usage: state-gallery ${definition.usage}`);
  if (command === "serve") {
    process.env.STATE_GALLERY_DATA ??= join(
      homedir(),
      ".state-gallery",
      "data",
    );
    await import("../server/index.js");
    return;
  }
  if (command === "init") {
    console.log(await createCaptureStarter(resolve(args[0] ?? ".")));
    console.log(
      "Run node state-gallery.capture.mjs from your app after installing playwright. Set STATE_GALLERY_APP_URL to its URL.",
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
  const c = Client.fromEnvironment();
  if (command === "create") {
    console.log(JSON.stringify(await c.createJourney(args[0]), null, 2));
    return;
  }
  if (command === "invite") {
    const g = await c.inviteMember(args[0], args[1]);
    console.log(
      JSON.stringify(
        {
          memberId: g.id,
          name: g.name,
          link: g.link,
          expiresAt: new Date(g.inviteExpiresAt).toISOString(),
        },
        null,
        2,
      ),
    );
    console.error(
      "Send this link privately. It works once and expires in 7 days.",
    );
    return;
  }
  if (command === "journeys") {
    console.log(JSON.stringify(await c.listJourneys(), null, 2));
    return;
  }
  if (command === "export") {
    await c.exportRequest(args[0], args[1], resolve(args[2]));
    console.log(`Exported request to ${resolve(args[2])}`);
  } else if (command === "import" || command === "submit") {
    const v = await c.submitManifest(args[0], resolve(args[1]), args[2]);
    console.log(JSON.stringify({ versionId: v.id }));
  } else if (command === "build-brief") {
    console.log(JSON.stringify(await c.getBuildBrief(args[0]), null, 2));
  } else throw new Error("Unknown command. Run state-gallery help.");
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
