import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { Store } from "./domain.js";
import { createServer } from "./http.js";
const dir = resolve(process.env.STATE_GALLERY_DATA ?? ".data");
mkdirSync(dir, { recursive: true, mode: 0o700 });
const hosted = process.env.STATE_GALLERY_HOSTED === "true";
let secret = process.env.STATE_GALLERY_OWNER_SECRET;
if (
  hosted &&
  (!secret || !process.env.STATE_GALLERY_ORIGIN?.startsWith("https://"))
)
  throw new Error(
    "Hosted mode requires an owner secret and HTTPS STATE_GALLERY_ORIGIN",
  );
if (!secret) {
  const path = resolve(dir, "owner-secret");
  if (!existsSync(path))
    writeFileSync(path, randomBytes(32).toString("base64url"), { mode: 0o600 });
  secret = readFileSync(path, "utf8").trim();
}
const port = Number(process.env.PORT ?? 4199);
const origin = process.env.STATE_GALLERY_ORIGIN ?? `http://localhost:${port}`;
const store = new Store(resolve(dir, "gallery.sqlite"));
const app = createServer({
  store,
  secret,
  origin,
  hosted,
  publicDir: resolve(new URL("../../public", import.meta.url).pathname),
});
app.listen(port, process.env.HOST ?? "127.0.0.1", () =>
  console.log(
    `State Gallery: ${origin} (owner secret is in the private data directory)`,
  ),
);
