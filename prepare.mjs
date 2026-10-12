import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

// Git dependencies contain source; packed installs already contain the runtime.
if (existsSync("src/server/index.ts")) {
  if (
    !existsSync("node_modules/typescript/bin/tsc") ||
    !existsSync("node_modules/vite/bin/vite.js")
  ) {
    if (
      !existsSync("dist/server/index.js") ||
      !existsSync("public/index.html")
    ) {
      throw new Error(
        "Building State Gallery from source requires dev dependencies. Run npm ci without --omit=dev.",
      );
    }
  } else {
    // Keep npm pack --json machine-readable; build output belongs on stderr.
    const result = spawnSync("npm", ["run", "build"], {
      stdio: ["inherit", 2, 2],
      shell: process.platform === "win32",
    });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  }
}
