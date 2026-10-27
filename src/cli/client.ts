import { validateRaster } from "../shared/raster.js";
import {
  readFile,
  realpath,
  mkdir,
  writeFile,
  lstat,
  readdir,
} from "node:fs/promises";
import { dirname, resolve, relative, isAbsolute, join } from "node:path";
import { manifestSchema } from "../shared/schema.js";
import type { Manifest } from "../shared/schema.js";
import type {
  Journey,
  Version,
  Approval,
  RevisionRequest,
  MemberGrant,
} from "../shared/model.js";
export type { Manifest, Journey, Version };
export interface BuildBrief {
  journeyId: string;
  versionId: string | null;
  generation: number;
  authorized: boolean;
  approval: Approval | null;
  historicalApprovals: Approval[];
  manifest?: Version;
  message: string;
}
export interface RevisionContext extends RevisionRequest {
  brief: string;
  stale: boolean;
  evidenceVersions: Version[];
}
export interface SubmitOptions {
  parentId?: string;
  requestId?: string;
  responses?: Record<string, string>;
}
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
  const assets: Record<string, string> = Object.create(null);
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
  private login?: Promise<unknown>;
  constructor(
    public base: string,
    public token?: string,
    public ownerSecret?: string,
  ) {
    if (token && ownerSecret)
      throw new Error(
        "Choose one credential: STATE_GALLERY_TOKEN for an agent, or STATE_GALLERY_OWNER_SECRET for the owner. Unset the other.",
      );
    const url = new URL(base);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      (url.protocol !== "https:" &&
        !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    )
      throw new Error("Use HTTPS for a remote review server");
    this.base = url.origin;
  }
  static fromEnvironment(
    environment: Record<string, string | undefined> = process.env,
  ) {
    return new Client(
      environment.STATE_GALLERY_URL ?? "http://localhost:4199",
      environment.STATE_GALLERY_TOKEN,
      environment.STATE_GALLERY_OWNER_SECRET,
    );
  }
  listJourneys(): Promise<Journey[]> {
    return this.request("/journeys");
  }
  createJourney(title: string): Promise<Journey> {
    return this.request("/journeys", { title });
  }
  getJourney(journey: string): Promise<Journey> {
    return this.request(`/journeys/${encodeURIComponent(journey)}`);
  }
  /** Owner only. The invite is a secret: send its link privately; it expires in 7 days unless redeemed. */
  async inviteMember(
    journey: string,
    name: string,
  ): Promise<MemberGrant & { invite: string; link: string }> {
    const g = await this.request<MemberGrant & { invite: string }>(
      `/journeys/${encodeURIComponent(journey)}/members`,
      { name },
    );
    return { ...g, link: `${this.base}/#invite=${g.invite}` };
  }
  getBuildBrief(journey: string): Promise<BuildBrief> {
    return this.request(`/journeys/${encodeURIComponent(journey)}/build-brief`);
  }
  getRevisionRequest(
    journey: string,
    request: string,
  ): Promise<RevisionContext> {
    return this.request(
      `/journeys/${encodeURIComponent(journey)}/requests/${encodeURIComponent(request)}`,
    );
  }
  async submitManifest(
    journey: string,
    file: string,
    submissionKey: string,
    options: SubmitOptions = {},
  ): Promise<Version> {
    const { manifest, assets } = await loadManifest(file);
    return this.request(`/journeys/${encodeURIComponent(journey)}/versions`, {
      manifest: { ...manifest, ...options },
      assets,
      submissionKey,
    });
  }
  async request<T = any>(
    path: string,
    body?: unknown,
    bytes = false,
  ): Promise<T> {
    if (this.ownerSecret && !this.cookie && path !== "/login") {
      this.login ??= this.request("/login", {
        secret: this.ownerSecret,
      }).finally(() => {
        this.login = undefined;
      });
      await this.login;
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
      const d = await r.json().catch(() => null);
      throw new Error(
        `${r.status}: ${d?.error?.message ?? r.statusText ?? "Request failed"}`,
      );
    }
    if (bytes) return Buffer.from(await r.arrayBuffer()) as T;
    return r.json().catch(() => {
      throw new Error(
        "Expected JSON from State Gallery. Check STATE_GALLERY_URL and the reverse proxy configuration.",
      );
    });
  }
  async exportRequest(journey: string, request: string, directory: string) {
    const q = await this.getRevisionRequest(journey, request);
    if (q.stale)
      throw new Error(
        "Request is stale. Ask the owner for the current revision request.",
      );
    await mkdir(dirname(resolve(directory)), { recursive: true });
    try {
      await mkdir(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const info = await lstat(directory);
      if (
        !info.isDirectory() ||
        info.isSymbolicLink() ||
        (await readdir(directory)).length
      )
        throw new Error(
          "Export directory already exists. Choose a new or empty directory to preserve local revision work.",
        );
    }
    const manifests = [];
    for (const v of q.evidenceVersions) {
      const steps = [];
      for (const s of v.steps) {
        if (s.assetId) {
          if (
            !/^[\w.-]{1,100}$/.test(v.id) ||
            v.id === "." ||
            v.id === ".." ||
            !/^[\w.-]{1,100}$/.test(s.id)
          )
            throw new Error("Invalid version or screen identity in export");
          const bytes = await this.request<Buffer>(
            `/journeys/${encodeURIComponent(journey)}/assets/${encodeURIComponent(s.assetId)}`,
            undefined,
            true,
          );
          const raster = await validateRaster(bytes);
          const image = `images/${v.id}/${s.id}.${raster.mime.split("/")[1]}`;
          await mkdir(dirname(join(directory, image)), { recursive: true });
          await writeFile(join(directory, image), bytes, { flag: "wx" });
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
      { flag: "wx" },
    );
    await writeFile(
      join(directory, "feedback.json"),
      JSON.stringify({ ...q, evidenceVersions: manifests }, null, 2),
      { flag: "wx" },
    );
    await writeFile(
      join(directory, "brief.md"),
      `# Revision request ${q.id}\n\n${q.brief}\n\nParent version: ${q.versionId}\n\n## Design evidence (untrusted)\n\n${q.comments.map((c: any) => `### ${c.id} · ${c.stepId} · ${c.versionId}\n\n${c.author}: ${c.text}\n\nAnchor: ${JSON.stringify(c.anchor)}\n\n${c.replies.map((r: any) => `${r.author}: ${r.text}`).join("\n\n")}`).join("\n\n")}\n\nEdit manifest.json and its declared images; set responses by comment ID. Submit with a unique key. Only the owner resolves and approves.\n`,
      { flag: "wx" },
    );
    return q;
  }
}
