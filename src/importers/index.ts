import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";
import { validateRaster } from "../shared/raster.js";
import { safeFile } from "../cli/client.js";
import { manifestSchema, type Manifest } from "../shared/schema.js";
const id = (key: string) =>
  key.replace(/[^\w.-]/g, "-").slice(0, 75) +
  "-" +
  createHash("sha256").update(key).digest("hex").slice(0, 12);
const label = (key: string) => key.replace(/[@/_-]+/g, " ");
async function imageInfo(root: string, image: string) {
  const file = await safeFile(root, image);
  const bytes = await readFile(file);
  const m = await validateRaster(bytes);
  return { width: m.width, height: m.height };
}
export async function importContentFactory(
  root: string,
  prefix?: string,
): Promise<Manifest> {
  const run = JSON.parse(
    await readFile(await safeFile(root, "run.json"), "utf8"),
  );
  if (!Array.isArray(run.entries) || !run.entries.length)
    throw new Error("run.json must contain captured entries");
  const seen = new Set<string>();
  const steps = [];
  for (const e of run.entries) {
    if (
      typeof e.path !== "string" ||
      typeof e.file !== "string" ||
      e.outcome !== "captured"
    )
      throw new Error("Malformed Content Factory entry");
    if (seen.has(e.path)) throw new Error(`Duplicate capture: ${e.path}`);
    seen.add(e.path);
    if (prefix && !e.path.startsWith(prefix)) continue;
    const dimensions = await imageInfo(root, e.file);
    const width = Number(/@(\d+)/.exec(e.path)?.[1]) || dimensions.width;
    steps.push({
      id: id(e.path),
      title: label(e.path.replace(/\.png$/, "")),
      purpose: "",
      transition: "",
      kind: "capture",
      viewport: { width, height: dimensions.height },
      outcome: "captured",
      image: e.file,
      provenance: `Content Factory ${e.path}; ${run.startedAt ?? "date unknown"}; comparison: ${e.comparison ?? "unknown"}. Current capture only. Original expected inventory unavailable.`,
      tags: ["content-factory"],
    });
  }
  return manifestSchema.parse({
    schemaVersion: 1,
    title: "Imported Content Factory states",
    coverage: "unknown",
    steps,
  });
}
export async function importSigma(
  root: string,
  prefix?: string,
): Promise<Manifest> {
  const inventory = JSON.parse(
    await readFile(await safeFile(root, "inventory.json"), "utf8"),
  );
  if (
    inventory.schemaVersion !== 1 ||
    !Array.isArray(inventory.keys) ||
    !inventory.keys.length ||
    inventory.keys.some((k: any) => typeof k !== "string") ||
    new Set(inventory.keys).size !== inventory.keys.length
  )
    throw new Error("Invalid or duplicate Sigma expected keys");
  const expected: string[] = inventory.keys;
  const rows = new Map<string, any>();
  async function scan(directory: string) {
    for (const e of await readdir(directory, { withFileTypes: true })) {
      if (e.isSymbolicLink())
        throw new Error(
          `Symlinks are not accepted in capture folders: ${e.name}`,
        );
      if (e.isDirectory()) await scan(join(directory, e.name));
      else if (e.name === "capture.json") {
        const c = JSON.parse(
          await readFile(
            await safeFile(root, relative(root, join(directory, e.name))),
            "utf8",
          ),
        );
        if (
          typeof c.key !== "string" ||
          !expected.includes(c.key) ||
          rows.has(c.key)
        )
          throw new Error(`Unexpected or duplicate checkpoint: ${c.key}`);
        if (
          !Array.isArray(c.images) ||
          !c.images.some((i: any) => i.kind === "viewport")
        )
          throw new Error(`Missing viewport record: ${c.key}`);
        const kinds = new Set();
        for (const i of c.images) {
          if (
            typeof i.file !== "string" ||
            i.file.includes("/") ||
            i.file.includes("\\") ||
            i.file === ".." ||
            !["viewport", "full-content"].includes(i.kind) ||
            kinds.has(i.kind)
          )
            throw new Error(`Invalid image record: ${c.key}`);
          kinds.add(i.kind);
          i.path = relative(root, join(directory, i.file));
          await imageInfo(root, i.path);
        }
        rows.set(c.key, c);
      }
    }
  }
  await scan(root);
  const selected = expected.filter((k) => !prefix || k.startsWith(prefix));
  if (!selected.length)
    throw new Error("No checkpoints match the selected prefix");
  const steps = [];
  for (const key of selected) {
    const c = rows.get(key);
    if (!c) {
      steps.push({
        id: id(key),
        title: label(key),
        kind: "gap",
        viewport: { width: 1440, height: 900 },
        outcome: "missing",
        provenance: `Sigma expected checkpoint missing: ${key}`,
        tags: ["sigma"],
      });
      continue;
    }
    const i = c.images.find((i: any) => i.kind === "viewport");
    const dimensions = await imageInfo(root, i.path);
    const viewport = i.viewport ?? c.viewport ?? dimensions;
    steps.push({
      id: id(key),
      title: `${c.scenario} · ${c.phase} · ${c.tableId}`,
      purpose: "",
      transition: "",
      kind: "capture",
      viewport,
      outcome: "captured",
      image: i.path,
      provenance: `Sigma ${key}; viewport image; ${c.images.length} image kinds recorded; content ${i.metadata?.contentHash ?? c.metadata?.contentHash ?? "unknown"}.`,
      tags: [
        String(c.scenario),
        String(c.phase),
        String(c.tableId),
        "viewport",
      ],
    });
  }
  return manifestSchema.parse({
    schemaVersion: 1,
    title: "Imported Sigma journey",
    coverage: steps.every((s) => s.outcome === "captured")
      ? "complete"
      : "partial",
    expected: selected.map(id),
    steps,
  });
}
