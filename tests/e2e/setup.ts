import { rm } from "node:fs/promises";
import { resolve } from "node:path";
export default async function () {
  await rm(resolve(".data/e2e"), { recursive: true, force: true });
}
