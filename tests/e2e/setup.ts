import { rm } from "node:fs/promises";
import { resolve } from "node:path";
export default async function () {
  for (const dir of [".data/e2e", ".data/e2e-notes"])
    await rm(resolve(dir), { recursive: true, force: true });
}
