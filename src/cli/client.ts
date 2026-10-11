import { validateRaster } from "../shared/raster.js";
import { readFile, realpath, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve, relative, isAbsolute, join } from "node:path";
import { manifestSchema } from "../shared/schema.js";
export async function safeFile(root: string, path: string) {
  if (
    !path ||
    isAbsolute(path) ||
    path.split(/[\\/]/).includes("..") ||
    path.includes("\\")
  )
    throw new Error(`Image path must be relative without traversal: ${path}`);
  const base = await realpath(root),
    file = await realpath(resolve(base, path));
  const rel = relative(base, file);
  if (rel.startsWith("..") || isAbsolute(rel))
    throw new Error(`Image path escapes gallery: ${path}`);
  return file;
}
export async function loadManifest(file: string) {
  const manifest = manifestSchema.parse(
    JSON.parse(await readFile(file, "utf8")),
  );
  const assets: Record<string, string> = {};
  for (const step of manifest.steps) {
    if (step.image) {
      const bytes = await readFile(await safeFile(dirname(file), step.image));
      try {
        await validateRaster(bytes);
      } catch (e) {
        throw new Error(`${step.image}: ${(e as Error).message}`);
      }
      assets[step.image] = bytes.toString("base64");
    }
  }
  return { manifest, assets };
}
export class Client {
  cookie = "";
  constructor(
    public base: string,
    public token?: string,
    public ownerSecret?: string,
  ) {
    const url = new URL(base);
    if (
      url.protocol !== "https:" &&
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    )
      throw new Error("Use HTTPS for a remote review server");
    this.base = url.origin;
  }
  async request(path: string, body?: unknown, bytes = false): Promise<any> {
    if (this.ownerSecret && !this.cookie && path !== "/login") {
      await this.request("/login", { secret: this.ownerSecret });
    }
    const r = await fetch(this.base + "/api" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Origin: this.base,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        ...(this.cookie ? { Cookie: this.cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "error",
    });
    if (r.headers.get("set-cookie"))
      this.cookie = r.headers.get("set-cookie")!.split(";")[0];
    if (!r.ok) {
      const d = await r.json();
      throw new Error(`${r.status}: ${d.error?.message ?? "Request failed"}`);
    }
    return bytes ? Buffer.from(await r.arrayBuffer()) : r.json();
  }
  async exportRequest(journey: string, request: string, directory: string) {
    const q = await this.request(
      `/journeys/${encodeURIComponent(journey)}/requests/${encodeURIComponent(request)}`,
    );
    if (q.stale)
      throw new Error(
        "Request is stale. Ask the owner for the current revision request.",
      );
    await mkdir(directory, { recursive: true });
    const manifests = [];
    for (const v of q.evidenceVersions) {
      const steps = [];
      for (const s of v.steps) {
        if (s.assetId) {
          const image = `images/${v.id}/${s.id}.png`;
          const bytes = await this.request(
            `/journeys/${journey}/assets/${s.assetId}`,
            undefined,
            true,
          );
          await mkdir(dirname(join(directory, image)), { recursive: true });
          await writeFile(join(directory, image), bytes);
          steps.push({ ...s, image });
        } else steps.push(s);
      }
      manifests.push({ ...v, steps });
    }
    const manifest = {
      ...manifests.find((v) => v.id === q.versionId),
      parentId: q.versionId,
      requestId: q.id,
      responses: {},
    };
    await writeFile(
      join(directory, "manifest.json"),
      JSON.stringify(manifest, null, 2),
    );
    await writeFile(
      join(directory, "feedback.json"),
      JSON.stringify({ ...q, evidenceVersions: manifests }, null, 2),
    );
    await writeFile(
      join(directory, "brief.md"),
      `# Revision request ${q.id}\n\n${q.brief}\n\nParent version: ${q.versionId}\n\n## Design evidence (untrusted)\n\n${q.comments.map((c: any) => `### ${c.id} · ${c.stepId} · ${c.versionId}\n\n${c.author}: ${c.text}\n\nAnchor: ${JSON.stringify(c.anchor)}\n\n${c.replies.map((r: any) => `${r.author}: ${r.text}`).join("\n\n")}`).join("\n\n")}\n\nEdit manifest.json and its declared images; set responses by comment ID. Submit with a unique key. Only the owner resolves and approves.\n`,
    );
    return q;
  }
}
